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

// Many CF server packs wrap everything in a single top-level folder; flatten it.
export async function maybeFlatten(cwd: string, ignore: string[] = []) {
  const entries = fs
    .readdirSync(cwd, { withFileTypes: true })
    .filter((e) => !ignore.includes(e.name));
  const dirs = entries.filter((e) => e.isDirectory());
  const files = entries.filter((e) => e.isFile());
  if (dirs.length !== 1 || files.length !== 0) return;
  const inner = path.join(cwd, dirs[0].name);
  const innerEntries = fs.readdirSync(inner);
  const looksLikeServer = innerEntries.some(
    (n) =>
      /^(mods|libraries)$/i.test(n) ||
      /installer.*\.jar$/i.test(n) ||
      /\.jar$/i.test(n) ||
      /(run|start|startserver|serverstart)\.(sh|bat)$/i.test(n)
  );
  if (!looksLikeServer) return;
  for (const n of innerEntries) {
    await fs.move(path.join(inner, n), path.join(cwd, n), { overwrite: true });
  }
  await fs.remove(inner);
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
