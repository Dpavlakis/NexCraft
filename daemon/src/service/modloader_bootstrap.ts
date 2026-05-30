import axios from "axios";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import fs from "fs-extra";
import iconv from "iconv-lite";
import { killProcess } from "mcsmanager-common";
import os from "os";
import path from "path";
import { getCommonHeaders } from "../common/network";
import Instance from "../entity/instance/instance";
import { $t } from "../i18n";
import downloadManager from "./download_manager";
import javaManager from "./java_manager";
import logger from "./log";

export type ModLoader = "vanilla" | "forge" | "neoforge" | "fabric" | "quilt";

export interface IBootstrapInput {
  instance: Instance;
  mcVersion: string;
  loader: ModLoader;
  loaderVersion: string;
  maxMemoryMB?: number;
}

export interface IBootstrapResult {
  startCommand: string;
}

// Offline fallback mapping of a Minecraft version to the Java major it needs.
// The authoritative source (Mojang's per-version javaVersion.majorVersion) is
// consulted first; this covers the case where that fetch fails.
export function staticJavaMajor(mc: string): number {
  const p = String(mc || "")
    .split(".")
    .map((n) => parseInt(n, 10));
  const major = p[0] || 0;
  const minor = p[1] || 0;
  const patch = p[2] || 0;
  // Post-"1.x" version scheme (e.g. "26.1.2"): a modern release whose exact Java
  // we can't know offline. Default high (never Java 8); the Mojang-manifest
  // lookup (preferred, see resolveJavaMajorForMc) returns the precise value
  // (e.g. 25) when online.
  if (major !== 1) return 21;
  if (minor >= 21) return 21; // 1.21+
  if (minor === 20 && patch >= 5) return 21; // 1.20.5 / 1.20.6
  if (minor >= 17) return 17; // 1.17 - 1.20.4
  return 8; // <= 1.16
}

// Shared HTTP helper for the standalone Java resolver below.
async function fetchJsonUrl<T>(url: string): Promise<T> {
  const res = await axios.get(url, { headers: getCommonHeaders(url), timeout: 20000 });
  return res.data as T;
}

// Resolve the Java major a Minecraft version needs, preferring Mojang's
// authoritative per-version javaVersion.majorVersion and falling back to the
// offline mapping. Shared by the modloader bootstrap and the server-jar path.
export async function resolveJavaMajorForMc(mc: string): Promise<number> {
  const fallback = staticJavaMajor(mc);
  try {
    const manifest = await fetchJsonUrl<any>(
      "https://launchermeta.mojang.com/mc/game/version_manifest.json"
    );
    const ver = manifest.versions?.find((v: any) => v.id === mc);
    if (ver?.url) {
      const j = await fetchJsonUrl<any>(ver.url);
      const mv = Number(j?.javaVersion?.majorVersion);
      if (Number.isFinite(mv) && mv > 0) return mv;
    }
  } catch {
    // network/parse failure — use the offline mapping
  }
  return fallback;
}

// Recursively find the first file whose basename matches `name`, up to maxDepth.
function findFile(dir: string, name: string, maxDepth = 8): string | undefined {
  if (maxDepth < 0 || !fs.existsSync(dir)) return undefined;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const e of entries) {
    if (e.isFile() && e.name === name) return path.join(dir, e.name);
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = findFile(path.join(dir, e.name), name, maxDepth - 1);
      if (found) return found;
    }
  }
  return undefined;
}

// Find a top-level (optionally one-level-deep) file matching a regex.
function findTopFile(dir: string, re: RegExp): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && re.test(e.name)) return path.join(dir, e.name);
  }
  return undefined;
}

export class ModloaderBootstrap {
  private process?: ChildProcessWithoutNullStreams;
  private pid?: number;
  private aborted = false;
  // Resolved at the start of run(): the java token baked into the start command
  // ("{mcsm_java}" when we provisioned a specific runtime, else "java") and the
  // real java executable path used to spawn loader installers.
  private startJava = "java";
  private installerJava = "java";

  constructor(private input: IBootstrapInput) {}

  private cwd() {
    return this.input.instance.absoluteCwdPath();
  }

  private memArgs() {
    const mem = this.input.maxMemoryMB && this.input.maxMemoryMB > 0 ? this.input.maxMemoryMB : 4096;
    return `-Xmx${mem}M -Xms${Math.min(mem, 1024)}M`;
  }

  // Resolve the java executable for both the installer spawn and the start command.
  private async javaCmd(): Promise<string> {
    const id = this.input.instance.config.java?.id;
    if (id) {
      try {
        const p = await javaManager.getJavaRuntimeCommand(id);
        if (p) return p.includes(" ") ? `"${p}"` : p;
      } catch {
        // fall through to system java
      }
    }
    return "java";
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await axios.get(url, { headers: getCommonHeaders(url), timeout: 20000 });
    return res.data as T;
  }

  private async fetchText(url: string): Promise<string> {
    const res = await axios.get(url, {
      headers: getCommonHeaders(url),
      timeout: 20000,
      responseType: "text"
    });
    return String(res.data);
  }

  // Resolve the latest stable loader version for the chosen Minecraft version
  // when one wasn't supplied (e.g. building a fresh server from scratch).
  private async resolveLoaderVersion(): Promise<string> {
    const mc = this.input.mcVersion;
    const loader = this.input.loader;
    try {
      if (loader === "fabric") {
        const arr = await this.fetchJson<any[]>(`https://meta.fabricmc.net/v2/versions/loader/${mc}`);
        return arr?.[0]?.loader?.version || "";
      }
      if (loader === "quilt") {
        const arr = await this.fetchJson<any[]>(`https://meta.quiltmc.org/v3/versions/loader/${mc}`);
        return arr?.[0]?.loader?.version || "";
      }
      if (loader === "neoforge") {
        const data = await this.fetchJson<any>(
          "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge"
        );
        const versions: string[] = data?.versions || [];
        // Legacy MC "1.21.1" -> NeoForge "21.1." (drop the leading "1."); the
        // newer year-based scheme "26.1.2" -> NeoForge "26.1.2." (full MC kept).
        const parts = String(mc).split(".");
        const prefix = parts[0] === "1" ? `${parts[1] || ""}.${parts[2] || "0"}.` : `${mc}.`;
        const matching = versions.filter((v) => v.startsWith(prefix));
        const stable = matching.filter((v) => !/beta|alpha|rc/i.test(v));
        const pick = stable.length ? stable : matching;
        return pick.length ? pick[pick.length - 1] : "";
      }
      if (loader === "forge") {
        // Promotions give recommended/latest for established versions.
        try {
          const data = await this.fetchJson<any>(
            "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"
          );
          const promos = data?.promos || {};
          const promo = promos[`${mc}-recommended`] || promos[`${mc}-latest`];
          if (promo) return String(promo);
        } catch {
          // fall through to maven metadata
        }
        // Fallback: scan Forge's maven metadata for any build of this MC. Covers
        // brand-new versions that only have betas / no promotion yet. Entries are
        // "<mc>-<forge>" (e.g. "26.1.2-64.0.8") — return the trailing build.
        const xml = await this.fetchText(
          "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml"
        );
        const builds = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
          .map((m) => m[1])
          .filter((v) => v.startsWith(`${mc}-`))
          .map((v) => v.slice(mc.length + 1));
        return builds.length ? builds[builds.length - 1] : "";
      }
    } catch {
      // fall through
    }
    return "";
  }

  // The java token to embed in the generated start command. When we've assigned
  // a managed runtime, use the {mcsm_java} placeholder so it resolves to that
  // runtime at launch (and survives Java path changes); otherwise plain "java".
  private startJavaToken(): string {
    return this.input.instance.config.java?.id ? "{mcsm_java}" : "java";
  }

  // Find the Java major version this Minecraft version needs. Prefer Mojang's
  // authoritative javaVersion.majorVersion (future-proof: if a future MC needs
  // Java 25, this returns 25), falling back to the offline mapping.
  private async resolveRequiredJavaMajor(): Promise<number> {
    return resolveJavaMajorForMc(this.input.mcVersion);
  }

  // Make sure a Java runtime matching this pack is available, downloading one if
  // needed, and record it on the instance config so the start command uses it.
  private async ensureJava() {
    // Respect an explicit user choice.
    if (this.input.instance.config.java?.id) return;
    if (!this.input.mcVersion) return;

    this.println($t("TXT_CODE_modpack.javaResolving"));
    const major = await this.resolveRequiredJavaMajor();
    if (!major) return;

    // If the daemon image's bundled Java already matches, just use it — no point
    // downloading a second copy of (typically) Java 21.
    const sys = await javaManager.getSystemJavaMajor();
    if (sys && sys === major) {
      this.println($t("TXT_CODE_modpack.javaUsingSystem", { ver: String(major) }));
      return;
    }

    try {
      const id = await javaManager.ensureJavaMajor(major, (m) => this.println(m));
      if (id) {
        const cfg = this.input.instance.config;
        cfg.java = { ...(cfg.java || {}), id };
        this.println($t("TXT_CODE_modpack.javaSelected", { ver: String(major) }));
      }
    } catch (e: any) {
      this.input.instance.println(
        "WARN",
        $t("TXT_CODE_modpack.javaAutoFailed", { err: e?.message || String(e) })
      );
    }
  }

  private println(text: string) {
    this.input.instance.println("INFO", text);
  }

  public cancel() {
    this.aborted = true;
    if (this.pid && this.process) {
      try {
        killProcess(this.pid, this.process);
      } catch {
        // ignore
      }
    }
  }

  // Spawn `java -jar <jar> <args>` in the instance cwd, streaming output to the console.
  private runJar(javaExe: string, jar: string, args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proc = spawn(javaExe.replace(/^"|"$/g, ""), ["-jar", jar, ...args], {
        cwd: this.cwd(),
        stdio: "pipe",
        windowsHide: true
      });
      if (!proc || !proc.pid) return reject(new Error($t("TXT_CODE_modpack.installerFailed")));
      this.process = proc;
      this.pid = proc.pid;
      const oe = this.input.instance.config.oe;
      proc.stdout.on("data", (t) => this.input.instance.print(iconv.decode(t, oe)));
      proc.stderr.on("data", (t) => this.input.instance.print(iconv.decode(t, oe)));
      proc.on("error", (err) => reject(err));
      proc.on("exit", (code) => {
        this.process = undefined;
        this.pid = undefined;
        if (this.aborted) return reject(new Error($t("TXT_CODE_modpack.cancelled")));
        if (code === 0) resolve();
        else reject(new Error($t("TXT_CODE_modpack.installerExit", { code: String(code) })));
      });
    });
  }

  // Build a start command from already-present server artifacts (CF server packs, post-install layout).
  // When `allowScripts` is false, the pack's own start scripts are ignored so we
  // can build a managed-Java (@args / -jar) command instead — pack scripts call
  // the system `java` and often self-restart, which hides crashes from the
  // auto-Java-on-launch recovery.
  private detectStartFromExisting(allowScripts = true): string | undefined {
    const javaExe = this.startJava;
    const cwd = this.cwd();
    // Forge/NeoForge 1.17+ args files
    const argsName = os.platform() === "win32" ? "win_args.txt" : "unix_args.txt";
    const argsFile = findFile(path.join(cwd, "libraries"), argsName, 10);
    if (argsFile && fs.existsSync(path.join(cwd, "user_jvm_args.txt"))) {
      const rel = path.relative(cwd, argsFile).split(path.sep).join("/");
      return `${javaExe} ${this.memArgs()} @user_jvm_args.txt @${rel} nogui`;
    }
    // Start scripts shipped by the pack (most CF Forge/NeoForge server packs)
    if (allowScripts) {
      const scripts =
        os.platform() === "win32"
          ? ["run.bat", "start.bat", "startserver.bat", "serverstart.bat"]
          : ["run.sh", "start.sh", "startserver.sh", "serverstart.sh"];
      for (const s of scripts) {
        const sp = path.join(cwd, s);
        if (fs.existsSync(sp)) {
          if (os.platform() !== "win32") {
            try {
              // CF packs ship CRLF .sh scripts (they have a .bat sibling); bash
              // chokes on \r, so normalize line endings, then make it executable.
              const content = fs.readFileSync(sp, "utf-8");
              if (content.includes("\r")) fs.writeFileSync(sp, content.replace(/\r\n/g, "\n"));
              fs.chmodSync(sp, 0o755);
            } catch {
              // ignore
            }
            return `bash ${s}`;
          }
          return s;
        }
      }
    }
    // Forge/NeoForge legacy universal/server jar
    const universal = findTopFile(cwd, /^(forge|neoforge)-.*\.jar$/i);
    if (universal && !/installer/i.test(path.basename(universal))) {
      return `${javaExe} ${this.memArgs()} -jar ${path.basename(universal)} nogui`;
    }
    // Fabric / Quilt launch jars
    for (const j of ["fabric-server-launch.jar", "quilt-server-launch.jar"]) {
      if (fs.existsSync(path.join(cwd, j))) {
        return `${javaExe} ${this.memArgs()} -jar ${j} nogui`;
      }
    }
    return undefined;
  }

  // The script-based start commands (CF run.sh/startserver.sh) invoke the system
  // `java` internally, so a provisioned runtime can't be injected there.
  private isScriptStart(cmd?: string): boolean {
    return !!cmd && /(^|\s)(bash\s+)?\.?\/?[\w-]+\.(sh|bat)\b/i.test(cmd);
  }

  private findInstallerJar(): string | undefined {
    return findTopFile(this.cwd(), /installer.*\.jar$/i) || findTopFile(this.cwd(), /-installer\.jar$/i);
  }

  private async downloadVanillaServer() {
    const cwd = this.cwd();
    const target = path.join(cwd, "server.jar");
    if (fs.existsSync(target)) return;
    this.println($t("TXT_CODE_modpack.fetchVanilla", { mc: this.input.mcVersion }));
    const manifest = await this.fetchJson<any>(
      "https://launchermeta.mojang.com/mc/game/version_manifest.json"
    );
    const ver = manifest.versions?.find((v: any) => v.id === this.input.mcVersion);
    if (!ver) throw new Error($t("TXT_CODE_modpack.noMcVersion", { mc: this.input.mcVersion }));
    const verJson = await this.fetchJson<any>(ver.url);
    const url = verJson?.downloads?.server?.url;
    if (!url) throw new Error($t("TXT_CODE_modpack.noServerJar", { mc: this.input.mcVersion }));
    await downloadManager.downloadFromUrl(url, target);
  }

  private async bootstrapVanilla(): Promise<IBootstrapResult> {
    await this.downloadVanillaServer();
    return { startCommand: `${this.startJava} ${this.memArgs()} -jar server.jar nogui` };
  }

  private async bootstrapFabricLike(kind: "fabric" | "quilt"): Promise<IBootstrapResult> {
    const cwd = this.cwd();
    const mc = this.input.mcVersion;
    const loaderVer = this.input.loaderVersion || (await this.resolveLoaderVersion());
    if (!loaderVer) throw new Error($t("TXT_CODE_modpack.unknownLoaderVersion"));
    const launchJar = kind === "fabric" ? "fabric-server-launch.jar" : "quilt-server-launch.jar";
    const meta = kind === "fabric" ? "https://meta.fabricmc.net/v2" : "https://meta.quiltmc.org/v3";

    // pick a stable installer version
    const installers = await this.fetchJson<any[]>(`${meta}/versions/installer`);
    const installerVer = (installers.find((i: any) => i.stable) || installers[0])?.version;
    if (!installerVer) throw new Error($t("TXT_CODE_modpack.noLoader", { loader: kind }));

    // The vanilla server jar is required by the launch jar
    await this.downloadVanillaServer();

    const jarUrl = `${meta}/versions/loader/${mc}/${loaderVer}/${installerVer}/server/jar`;
    this.println($t("TXT_CODE_modpack.fetchLoader", { loader: kind, version: loaderVer }));
    await downloadManager.downloadFromUrl(jarUrl, path.join(cwd, launchJar));
    return { startCommand: `${this.startJava} ${this.memArgs()} -jar ${launchJar} nogui` };
  }

  private async bootstrapForgeLike(kind: "forge" | "neoforge"): Promise<IBootstrapResult> {
    const cwd = this.cwd();
    const mc = this.input.mcVersion;
    // Use the supplied loader version, or resolve the latest for this MC version
    // (CurseForge doesn't give one; fresh server builds don't either).
    const lv = this.input.loaderVersion || (await this.resolveLoaderVersion());
    if (!lv || (kind === "forge" && !mc)) {
      throw new Error($t("TXT_CODE_modpack.unknownLoaderVersion"));
    }
    const installerUrl =
      kind === "forge"
        ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${lv}/forge-${mc}-${lv}-installer.jar`
        : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${lv}/neoforge-${lv}-installer.jar`;
    const installerPath = path.join(cwd, "installer.jar");
    this.println($t("TXT_CODE_modpack.fetchLoader", { loader: kind, version: lv }));
    await downloadManager.downloadFromUrl(installerUrl, installerPath);

    this.println($t("TXT_CODE_modpack.runInstaller"));
    await this.runJar(this.installerJava, "installer.jar", ["--installServer"]);

    // cleanup installer artifacts
    for (const f of ["installer.jar", "installer.jar.log"]) {
      try {
        await fs.remove(path.join(cwd, f));
      } catch {
        // ignore
      }
    }

    const start = this.detectStartFromExisting(false);
    if (!start) throw new Error($t("TXT_CODE_modpack.noStartArtifact"));
    return { startCommand: start };
  }

  public async run(): Promise<IBootstrapResult> {
    // First classify what kind of start the pack already provides (a cheap fs
    // probe; the java token doesn't affect classification).
    this.startJava = "java";
    this.installerJava = "java";
    let start = this.detectStartFromExisting();

    // A pack start script (CF run.sh/startserver.sh) runs the system `java` and
    // frequently self-restarts on crash — which hides a Java-version mismatch from
    // the auto-Java-on-launch recovery (the process never "stops"). If we can
    // bootstrap this loader with a managed Java (known loader, or a bundled
    // installer is present), prefer that over the pack script. Only fall back to
    // the script when we can't self-bootstrap.
    if (start && this.isScriptStart(start)) {
      const manageableLoaders = ["forge", "neoforge", "fabric", "quilt", "vanilla"];
      const canSelfBootstrap =
        manageableLoaders.includes(this.input.loader) || !!this.findInstallerJar();
      if (!canSelfBootstrap) {
        try {
          const major = staticJavaMajor(this.input.mcVersion);
          const sys = await javaManager.getSystemJavaMajor();
          if (major && sys && sys !== major) {
            this.input.instance.println(
              "WARN",
              $t("TXT_CODE_modpack.javaWarn", { mc: this.input.mcVersion })
            );
          }
        } catch {
          // ignore — classification only
        }
        this.println($t("TXT_CODE_modpack.startDetected", { cmd: start }));
        return { startCommand: start };
      }
      this.println($t("TXT_CODE_modpack.preferManagedJava"));
    }

    // Otherwise we control the java invocation — provision the right Java first
    // so both the loader installer and the start command use it.
    await this.ensureJava();
    this.installerJava = await this.javaCmd();
    this.startJava = this.startJavaToken();

    // 1) Re-detect now that the java token may have changed. Ignore pack scripts
    //    on the managed path so we build an @args/-jar command we can inject Java into.
    start = this.detectStartFromExisting(false);
    if (start) {
      this.println($t("TXT_CODE_modpack.startDetected", { cmd: start }));
      return { startCommand: start };
    }

    // 2) Pack may ship a modloader installer that just needs --installServer
    const bundled = this.findInstallerJar();
    if (bundled) {
      this.println($t("TXT_CODE_modpack.runInstaller"));
      await this.runJar(this.installerJava, path.basename(bundled), ["--installServer"]);
      try {
        await fs.remove(bundled);
      } catch {
        // ignore
      }
      start = this.detectStartFromExisting(false);
      if (start) {
        this.println($t("TXT_CODE_modpack.startDetected", { cmd: start }));
        return { startCommand: start };
      }
    }

    // 3) Bootstrap from scratch by loader
    let result: IBootstrapResult;
    switch (this.input.loader) {
      case "forge":
      case "neoforge":
        result = await this.bootstrapForgeLike(this.input.loader);
        break;
      case "fabric":
        result = await this.bootstrapFabricLike("fabric");
        break;
      case "quilt":
        result = await this.bootstrapFabricLike("quilt");
        break;
      default:
        result = await this.bootstrapVanilla();
        break;
    }

    this.println($t("TXT_CODE_modpack.startDetected", { cmd: result.startCommand }));
    return result;
  }
}
