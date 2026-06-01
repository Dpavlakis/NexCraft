import axios from "axios";
import fs from "fs-extra";
import StreamZip from "node-stream-zip";
import path from "path";
import downloadManager from "./download_manager";
import type { ModLoader } from "./modloader_bootstrap";

export interface MrpackFile {
  path: string;
  downloads: string[];
  fileSize?: number;
  env?: { server?: string; client?: string };
}

export interface MrpackIndex {
  formatVersion?: number;
  name?: string;
  versionId?: string;
  dependencies: Record<string, string>;
  files: MrpackFile[];
}

// Client-only mods that ship in "optimization"/client modpacks but crash a
// dedicated server (they advertise server support or arrive via overrides, so
// the Modrinth env filter can't catch them). Matched against the jar filename.
// Extend this list as new offenders are found.
export const CLIENT_ONLY_CRASH_MODS: RegExp[] = [
  /(^|[^a-z])e4mc/i // world-sharing tunnel: NoSuchMethodError on join
];

// Remove known client-only mods from <cwd>/mods so a client modpack installed
// as a server can still boot. Returns the removed filenames.
export async function removeKnownClientMods(cwd: string): Promise<string[]> {
  const modsDir = path.join(cwd, "mods");
  if (!fs.existsSync(modsDir)) return [];
  const removed: string[] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(modsDir);
  } catch {
    return [];
  }
  for (const name of entries) {
    if (!/\.jar$/i.test(name)) continue;
    if (CLIENT_ONLY_CRASH_MODS.some((re) => re.test(name))) {
      try {
        await fs.remove(path.join(modsDir, name));
        removed.push(name);
      } catch {
        // ignore — best effort
      }
    }
  }
  return removed;
}

// Files/dirs preserved across a modpack update (never deleted or overwritten).
export const MODPACK_PRESERVE_FILES = [
  "server.properties",
  "ops.json",
  "whitelist.json",
  "white-list.txt",
  "banned-players.json",
  "banned-ips.json",
  "usercache.json",
  "eula.txt",
  "server-icon.png"
];
export const MODPACK_PRESERVE_DIRS = ["logs", "crash-reports"];

// Replaceable artifacts removed before re-applying a pack during update.
export const MODPACK_REPLACE_DIRS = ["mods", "config", "libraries", "defaultconfigs", "kubejs"];

// Read the configured world directory name from <instanceDir>/server.properties
// (`level-name`). Defaults to "world" when absent/unreadable. The save lives at
// <cwd>/<level-name> (Java) or <cwd>/worlds/<level-name> (Bedrock), so this name
// must be preserved across a preserve_world reinstall or the save is wiped.
export function readLevelName(cwd: string): string {
  try {
    const raw = fs.readFileSync(path.join(cwd, "server.properties"), "utf-8");
    const m = raw.match(/^[ \t]*level-name[ \t]*=[ \t]*(.*?)[ \t]*$/im);
    const name = m?.[1]?.trim();
    if (name) return name;
  } catch {
    // ignore — fall through to default
  }
  return "world";
}

// Build the preserve predicate. When `cwd` is given, the real configured world
// name (server.properties `level-name`, default "world") is preserved in
// addition to the standard world*/world_nether/world_the_end/DIM* coverage.
export function makeShouldPreserve(cwd?: string) {
  const levelName = cwd ? readLevelName(cwd) : "world";
  return (relPath: string) => {
    const p = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!p) return true;
    const top = p.split("/")[0];
    if (top.startsWith("world")) return true;
    if (top.startsWith("DIM")) return true;
    if (top === levelName) return true;
    // Bedrock stores its world under worlds/<level-name>/ — preserve that tree.
    if (top === "worlds") return true;
    if (MODPACK_PRESERVE_DIRS.includes(top)) return true;
    if (MODPACK_PRESERVE_FILES.includes(p)) return true;
    return false;
  };
}

export function resolveLoader(deps: Record<string, string>): {
  loader: ModLoader;
  loaderVersion: string;
} {
  if (deps["neoforge"]) return { loader: "neoforge", loaderVersion: deps["neoforge"] };
  if (deps["forge"]) return { loader: "forge", loaderVersion: deps["forge"] };
  if (deps["fabric-loader"]) return { loader: "fabric", loaderVersion: deps["fabric-loader"] };
  if (deps["quilt-loader"]) return { loader: "quilt", loaderVersion: deps["quilt-loader"] };
  return { loader: "vanilla", loaderVersion: "" };
}

// Resolve a zip-relative path under base, rejecting path traversal.
function safeJoin(base: string, rel: string): string | null {
  const dest = path.normalize(path.join(base, rel));
  if (dest !== base && !dest.startsWith(base + path.sep)) return null;
  return dest;
}

export async function parseMrpackIndex(mrpackPath: string): Promise<MrpackIndex> {
  const zip = new StreamZip.async({ file: mrpackPath });
  try {
    const buf = await zip.entryData("modrinth.index.json");
    return JSON.parse(buf.toString("utf-8"));
  } finally {
    await zip.close();
  }
}

// Download every server-relevant file from a parsed .mrpack index into cwd.
// Files are fetched with a bounded concurrency pool (much faster than serial for
// the many small mod jars in a typical pack).
export async function downloadMrpackFiles(
  index: MrpackIndex,
  cwd: string,
  onProgress?: (done: number, total: number) => void,
  skip?: (relPath: string) => boolean,
  concurrency = 8
) {
  const files = (index.files || []).filter((f) => (f.env?.server ?? "required") !== "unsupported");
  const total = files.length;
  let done = 0;
  let next = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= files.length) return;
      const f = files[i];
      try {
        if (!(skip && skip(f.path))) {
          const dest = safeJoin(cwd, f.path);
          const url = f.downloads?.[0];
          if (dest && url) await downloadManager.downloadFromUrl(url, dest, f.downloads?.[1]);
        }
      } finally {
        done++;
        if (onProgress) onProgress(done, total);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length || 1) }, () => worker())
  );
}

// ---- FTB (api.modpacks.ch) ----
// An FTB version manifest gives a flat list of files (each with a direct CDN
// URL) plus "targets" describing the Minecraft + modloader versions. Installing
// a server = download every non-client file, then bootstrap the loader — the
// same shape as a Modrinth .mrpack.
export interface FtbFile {
  path: string; // e.g. "./config/Foo/"
  name: string;
  url: string;
  clientonly?: boolean;
  serveronly?: boolean;
}
export interface FtbVersionManifest {
  files: FtbFile[];
  targets: { type: string; name: string; version: string }[];
}

export async function fetchFtbVersion(
  packId: number,
  versionId: number
): Promise<FtbVersionManifest> {
  const res = await axios.get(
    `https://api.modpacks.ch/public/modpack/${packId}/${versionId}`,
    { timeout: 30000 }
  );
  return res.data as FtbVersionManifest;
}

export function ftbTargets(manifest: FtbVersionManifest): {
  mc: string;
  loader: ModLoader;
  loaderVersion: string;
} {
  let mc = "";
  let loader: ModLoader = "vanilla";
  let loaderVersion = "";
  for (const t of manifest.targets || []) {
    if (t.type === "game" || t.name === "minecraft") mc = t.version || mc;
    if (t.type === "modloader") {
      const n = (t.name || "").toLowerCase();
      // Only adopt the version when we recognise the loader, so an unknown
      // loader name can't leave loader="vanilla" with a stray loaderVersion.
      if (n === "neoforge" || n === "forge" || n === "fabric" || n === "quilt") {
        loader = n;
        loaderVersion = t.version || "";
      }
    }
  }
  return { mc, loader, loaderVersion };
}

// Download every server-relevant file from an FTB version manifest into cwd
// (skipping client-only files), with a bounded concurrency pool.
export async function downloadFtbFiles(
  manifest: FtbVersionManifest,
  cwd: string,
  onProgress?: (done: number, total: number) => void,
  skip?: (relPath: string) => boolean,
  concurrency = 8
) {
  const files = (manifest.files || []).filter((f) => !f.clientonly && !!f.url);
  const total = files.length;
  let done = 0;
  let next = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= files.length) return;
      const f = files[i];
      try {
        // FTB paths look like "./config/Foo/"; strip the leading "./" and any
        // surrounding slashes. A root-level file ("" or "/") must NOT yield a
        // leading-slash rel, or path.join(cwd, "/x") drops cwd → file lost.
        const dir = (f.path || "").replace(/^\.?\/+/, "").replace(/\/+$/, "");
        const rel = dir ? `${dir}/${f.name}` : f.name;
        if (!(skip && skip(rel))) {
          const dest = safeJoin(cwd, rel);
          if (dest) await downloadManager.downloadFromUrl(f.url, dest);
        }
      } finally {
        done++;
        if (onProgress) onProgress(done, total);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length || 1) }, () => worker())
  );
}

// Extract overrides/ then server-overrides/ from a .mrpack into cwd (server-overrides win).
export async function extractMrpackOverrides(
  mrpackPath: string,
  cwd: string,
  skip?: (relPath: string) => boolean
) {
  const zip = new StreamZip.async({ file: mrpackPath });
  try {
    const entries = await zip.entries();
    const names = Object.keys(entries);
    for (const prefix of ["overrides/", "server-overrides/"]) {
      for (const name of names) {
        const entry = entries[name];
        if (entry.isDirectory) continue;
        if (!name.startsWith(prefix)) continue;
        const rel = name.slice(prefix.length);
        if (!rel) continue;
        if (skip && skip(rel)) continue;
        const dest = safeJoin(cwd, rel);
        if (!dest) continue;
        await fs.ensureDir(path.dirname(dest));
        await zip.extract(name, dest);
      }
    }
  } finally {
    await zip.close();
  }
}

// Extract a zip into cwd with overwrite (node-stream-zip), optionally skipping paths.
export async function extractZipOverwrite(
  zipPath: string,
  cwd: string,
  skip?: (relPath: string) => boolean
) {
  const zip = new StreamZip.async({ file: zipPath });
  try {
    await fs.ensureDir(cwd);
    const entries = await zip.entries();
    // Always extract entry-by-entry via safeJoin so a malicious archive can't
    // escape cwd (zip-slip: entries with ".." or absolute paths). zip.extract
    // with a null entry would write the whole archive without this guard.
    for (const name of Object.keys(entries)) {
      const entry = entries[name];
      if (entry.isDirectory) continue;
      if (skip && skip(name)) continue;
      const dest = safeJoin(cwd, name);
      if (!dest) throw new Error(`Refusing to extract entry outside target dir: ${name}`);
      await fs.ensureDir(path.dirname(dest));
      await zip.extract(name, dest);
    }
  } finally {
    await zip.close();
  }
}

// True if a directory's immediate children look like a runnable MC server root.
export function hasServerMarkers(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return false;
  }
  return names.some(
    (n) =>
      /^(mods|libraries|config|defaultconfigs)$/i.test(n) ||
      /installer.*\.jar$/i.test(n) ||
      /^(forge|neoforge|fabric|quilt).*\.jar$/i.test(n) ||
      /^(minecraft_server|server)[^/]*\.jar$/i.test(n) ||
      /(run|start|startserver|serverstart)\.(sh|bat)$/i.test(n) ||
      /_args\.txt$/i.test(n) ||
      n === "user_jvm_args.txt"
  );
}

// CF server packs often wrap everything in one folder (sometimes alongside a
// readme/license at the top). If the server root is one level down, hoist it.
export async function maybeFlatten(cwd: string, ignore: string[] = []) {
  if (hasServerMarkers(cwd)) return; // already at the root — never flatten
  const dirs = fs
    .readdirSync(cwd, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !ignore.includes(e.name));
  for (const d of dirs) {
    const inner = path.join(cwd, d.name);
    if (hasServerMarkers(inner)) {
      for (const n of fs.readdirSync(inner)) {
        await fs.move(path.join(inner, n), path.join(cwd, n), { overwrite: true });
      }
      await fs.remove(inner);
      return;
    }
  }
}

// Remove replaceable mod/config/loader artifacts before re-applying a pack on update.
// Clear an instance folder for a reinstall/reset.
//  - preserveWorld=false: remove EVERYTHING (a clean, fresh install).
//  - preserveWorld=true:  keep world/player data + server config (makeShouldPreserve),
//    removing mods/config/loader artifacts so a new pack installs over the world.
// Backups live outside the instance cwd (data/backups), so they're never touched here.
export async function clearForReset(cwd: string, preserveWorld: boolean) {
  if (!fs.existsSync(cwd)) {
    await fs.ensureDir(cwd);
    return;
  }
  const skip = preserveWorld ? makeShouldPreserve(cwd) : null;
  for (const name of fs.readdirSync(cwd)) {
    if (skip && skip(name)) continue;
    try {
      await fs.remove(path.join(cwd, name));
    } catch {
      // ignore
    }
  }
}

export async function clearReplaceableArtifacts(cwd: string) {
  for (const d of MODPACK_REPLACE_DIRS) {
    try {
      await fs.remove(path.join(cwd, d));
    } catch {
      // ignore
    }
  }
  // loader jars + generated start artifacts
  for (const e of fs.readdirSync(cwd, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    if (
      /^(forge|neoforge)-.*\.jar$/i.test(e.name) ||
      /^(fabric|quilt)-server-launch\.jar$/i.test(e.name) ||
      /^server\.jar$/i.test(e.name) ||
      /_args\.txt$/i.test(e.name) ||
      e.name === "user_jvm_args.txt" ||
      /^run\.(sh|bat)$/i.test(e.name) ||
      /installer.*\.jar$/i.test(e.name)
    ) {
      try {
        await fs.remove(path.join(cwd, e.name));
      } catch {
        // ignore
      }
    }
  }
}
