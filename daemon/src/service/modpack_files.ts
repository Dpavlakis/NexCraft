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

export function makeShouldPreserve() {
  return (relPath: string) => {
    const p = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!p) return true;
    const top = p.split("/")[0];
    if (top.startsWith("world")) return true;
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
export async function downloadMrpackFiles(
  index: MrpackIndex,
  cwd: string,
  onProgress?: (done: number, total: number) => void,
  skip?: (relPath: string) => boolean
) {
  const files = (index.files || []).filter((f) => (f.env?.server ?? "required") !== "unsupported");
  let done = 0;
  for (const f of files) {
    done++;
    if (onProgress) onProgress(done, files.length);
    if (skip && skip(f.path)) continue;
    const dest = safeJoin(cwd, f.path);
    if (!dest) continue;
    const url = f.downloads?.[0];
    if (!url) continue;
    await downloadManager.downloadFromUrl(url, dest, f.downloads?.[1]);
  }
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
    if (!skip) {
      await fs.ensureDir(cwd);
      await zip.extract(null, cwd);
      return;
    }
    const entries = await zip.entries();
    for (const name of Object.keys(entries)) {
      const entry = entries[name];
      if (entry.isDirectory) continue;
      if (skip(name)) continue;
      const dest = safeJoin(cwd, name);
      if (!dest) continue;
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
