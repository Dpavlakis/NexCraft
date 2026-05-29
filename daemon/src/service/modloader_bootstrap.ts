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
  private detectStartFromExisting(javaExe: string): string | undefined {
    const cwd = this.cwd();
    // Forge/NeoForge 1.17+ args files
    const argsName = os.platform() === "win32" ? "win_args.txt" : "unix_args.txt";
    const argsFile = findFile(path.join(cwd, "libraries"), argsName, 10);
    if (argsFile && fs.existsSync(path.join(cwd, "user_jvm_args.txt"))) {
      const rel = path.relative(cwd, argsFile).split(path.sep).join("/");
      return `${javaExe} ${this.memArgs()} @user_jvm_args.txt @${rel} nogui`;
    }
    // Start scripts shipped by the pack (most CF Forge/NeoForge server packs)
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

  private async bootstrapVanilla(javaExe: string): Promise<IBootstrapResult> {
    await this.downloadVanillaServer();
    return { startCommand: `${javaExe} ${this.memArgs()} -jar server.jar nogui` };
  }

  private async bootstrapFabricLike(javaExe: string, kind: "fabric" | "quilt"): Promise<IBootstrapResult> {
    const cwd = this.cwd();
    const mc = this.input.mcVersion;
    const loaderVer = this.input.loaderVersion;
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
    return { startCommand: `${javaExe} ${this.memArgs()} -jar ${launchJar} nogui` };
  }

  private async bootstrapForgeLike(javaExe: string, kind: "forge" | "neoforge"): Promise<IBootstrapResult> {
    const cwd = this.cwd();
    const mc = this.input.mcVersion;
    const lv = this.input.loaderVersion;
    // We can only download an installer if we know the exact loader version.
    // CurseForge doesn't give us one, so this path is only reached when the
    // server pack shipped no runnable artifacts — surface a clear error.
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
    await this.runJar(javaExe, "installer.jar", ["--installServer"]);

    // cleanup installer artifacts
    for (const f of ["installer.jar", "installer.jar.log"]) {
      try {
        await fs.remove(path.join(cwd, f));
      } catch {
        // ignore
      }
    }

    const start = this.detectStartFromExisting(javaExe);
    if (!start) throw new Error($t("TXT_CODE_modpack.noStartArtifact"));
    return { startCommand: start };
  }

  public async run(): Promise<IBootstrapResult> {
    const javaExe = await this.javaCmd();

    // 1) Pack may already ship runnable artifacts (CF server packs)
    let start = this.detectStartFromExisting(javaExe);
    if (start) {
      this.println($t("TXT_CODE_modpack.startDetected", { cmd: start }));
      return { startCommand: start };
    }

    // 2) Pack may ship a modloader installer that just needs --installServer
    const bundled = this.findInstallerJar();
    if (bundled) {
      this.println($t("TXT_CODE_modpack.runInstaller"));
      await this.runJar(javaExe, path.basename(bundled), ["--installServer"]);
      try {
        await fs.remove(bundled);
      } catch {
        // ignore
      }
      start = this.detectStartFromExisting(javaExe);
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
        result = await this.bootstrapForgeLike(javaExe, this.input.loader);
        break;
      case "fabric":
        result = await this.bootstrapFabricLike(javaExe, "fabric");
        break;
      case "quilt":
        result = await this.bootstrapFabricLike(javaExe, "quilt");
        break;
      default:
        result = await this.bootstrapVanilla(javaExe);
        break;
    }

    // Java-version mismatch warning for old packs
    const minor = Number(this.input.mcVersion.split(".")[1] || "0");
    if (minor && minor < 17 && !this.input.instance.config.java?.id) {
      this.input.instance.println("WARN", $t("TXT_CODE_modpack.javaWarn", { mc: this.input.mcVersion }));
    }

    this.println($t("TXT_CODE_modpack.startDetected", { cmd: result.startCommand }));
    return result;
  }
}
