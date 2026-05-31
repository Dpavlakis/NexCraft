import archiver from "archiver";
import fs from "fs-extra";
import path from "path";
import Instance from "../entity/instance/instance";
import { $t } from "../i18n";
import { backupDir } from "./backup_service";
import { readLevelName } from "./modpack_files";

export type WorldKind = "java" | "bedrock";

// Temp dirs (under the instance cwd). Dot-prefixed so they sort out of the way and
// match the project's existing convention (cf. .mcsm_update_stage in ModpackUpdateTask).
export const WORLD_UPLOAD_DIR = ".nexcraft_world_up";
export const WORLD_EXTRACT_DIR = ".nexcraft_world_extract";
export const WORLD_DOWNLOAD_DIR = ".nexcraft_world_dl";

export function getWorldKind(instance: Instance): WorldKind {
  return String(instance.config?.type || "").includes("bedrock") ? "bedrock" : "java";
}

// World top-level folders RELATIVE TO cwd, only those that exist.
//  Java:    <level-name>, <level-name>_nether, <level-name>_the_end
//           (modded dimensions nest inside <level-name>/DIM*, so they ride along).
//  Bedrock: worlds/<level-name>
export function getActiveWorldPaths(cwd: string, kind: WorldKind, levelName: string): string[] {
  if (kind === "bedrock") {
    const rel = path.posix.join("worlds", levelName);
    return fs.existsSync(path.join(cwd, "worlds", levelName)) ? [rel] : [];
  }
  const candidates = [levelName, `${levelName}_nether`, `${levelName}_the_end`];
  return candidates.filter((rel) => fs.existsSync(path.join(cwd, rel)));
}

// Locate the directory containing level.dat (the world root) within an extracted
// upload. BFS with a depth cap so a deeply/oddly nested archive still resolves.
export function findWorldRoot(dir: string): string | undefined {
  const queue: Array<{ d: string; depth: number }> = [{ d: dir, depth: 0 }];
  while (queue.length) {
    const { d, depth } = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((e) => e.isFile() && e.name === "level.dat")) return d;
    if (depth >= 6) continue;
    for (const e of entries) {
      if (e.isDirectory()) queue.push({ d: path.join(d, e.name), depth: depth + 1 });
    }
  }
  return undefined;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_") || "world";
}

// Browser-suggested download filename. Java -> <level>.zip, Bedrock -> <level>.mcworld
export function worldDownloadFileName(kind: WorldKind, levelName: string): string {
  const base = sanitizeFileName(levelName);
  return kind === "bedrock" ? `${base}.mcworld` : `${base}.zip`;
}

function worldTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
}

async function dirSizeAndMtime(absDir: string): Promise<{ size: number; mtimeMs: number }> {
  let size = 0;
  let mtimeMs = 0;
  const walk = async (p: string) => {
    let stat: fs.Stats;
    try {
      stat = await fs.stat(p);
    } catch {
      return;
    }
    mtimeMs = Math.max(mtimeMs, stat.mtimeMs);
    if (stat.isDirectory()) {
      const names = await fs.readdir(p);
      for (const n of names) await walk(path.join(p, n));
    } else {
      size += stat.size;
    }
  };
  await walk(absDir);
  return { size, mtimeMs };
}

export interface IWorldInfo {
  levelName: string;
  kind: WorldKind;
  exists: boolean;
  size: number;
  lastModified: number;
}

export async function getWorldInfo(instance: Instance): Promise<IWorldInfo> {
  const cwd = instance.absoluteCwdPath();
  const kind = getWorldKind(instance);
  const levelName = readLevelName(cwd);
  const rels = getActiveWorldPaths(cwd, kind, levelName);
  let size = 0;
  let lastModified = 0;
  for (const rel of rels) {
    const { size: s, mtimeMs } = await dirSizeAndMtime(path.join(cwd, rel));
    size += s;
    lastModified = Math.max(lastModified, mtimeMs);
  }
  return { levelName, kind, exists: rels.length > 0, size, lastModified };
}

// Helper: zip a set of absolute folders into destZip.
//  entries[].name === false  -> that folder's CONTENTS are placed at the zip root
//  entries[].name === string -> that folder is nested under the given relative name
function zipFolders(
  entries: Array<{ abs: string; name: string | false }>,
  destZip: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(destZip);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("warning", (err: any) => {
      if (err?.code !== "ENOENT") reject(err);
    });
    archive.on("error", reject);
    archive.pipe(output);
    for (const e of entries) archive.directory(e.abs, e.name as any);
    archive.finalize().catch(reject);
  });
}

// Build a downloadable world archive.
//  Java:    each world folder kept at its relative name (world/, world_nether/, ...).
//  Bedrock: contents of worlds/<level> placed at the zip root (a valid .mcworld).
export async function zipWorld(
  cwd: string,
  kind: WorldKind,
  levelName: string,
  destZip: string
): Promise<void> {
  const rels = getActiveWorldPaths(cwd, kind, levelName);
  if (rels.length === 0) throw new Error($t("TXT_CODE_world.noWorld"));
  await fs.ensureDir(path.dirname(destZip));
  if (kind === "bedrock") {
    await zipFolders([{ abs: path.join(cwd, rels[0]), name: false }], destZip);
  } else {
    await zipFolders(rels.map((rel) => ({ abs: path.join(cwd, rel), name: rel })), destZip);
  }
}

// World-ONLY backup into the existing Backups area. Entries keep their relative
// paths (Java: world/..., world_nether/...; Bedrock: worlds/<level>/...) so the
// archive is restore-compatible with the Backups card / RestoreTask (which
// extracts straight into cwd). Named world-<ts>.zip to distinguish from full
// backup-<ts>.zip. Returns the absolute path, or undefined if there is no world.
export async function backupActiveWorld(instance: Instance): Promise<string | undefined> {
  const cwd = instance.absoluteCwdPath();
  const kind = getWorldKind(instance);
  const levelName = readLevelName(cwd);
  const rels = getActiveWorldPaths(cwd, kind, levelName);
  if (rels.length === 0) return undefined;
  const dir = backupDir(instance.instanceUuid);
  await fs.ensureDir(dir);
  const dest = path.join(dir, `world-${worldTimestamp()}.zip`);
  await zipFolders(rels.map((rel) => ({ abs: path.join(cwd, rel), name: rel })), dest);
  return dest;
}

export async function wipeActiveWorld(
  cwd: string,
  kind: WorldKind,
  levelName: string
): Promise<void> {
  for (const rel of getActiveWorldPaths(cwd, kind, levelName)) {
    await fs.remove(path.join(cwd, rel));
  }
}

// Install an uploaded world (srcRoot = the dir that contains level.dat) at the
// active level-name location.
//  Bedrock: copy srcRoot contents into worlds/<level>/.
//  Java:    copy srcRoot contents into <level>/, and any sibling _nether/_the_end
//           dimension folders into <level>_nether / <level>_the_end.
export async function placeWorld(
  srcRoot: string,
  cwd: string,
  kind: WorldKind,
  levelName: string
): Promise<void> {
  if (kind === "bedrock") {
    const dest = path.join(cwd, "worlds", levelName);
    await fs.ensureDir(dest);
    await fs.copy(srcRoot, dest, { overwrite: true });
    return;
  }
  const dest = path.join(cwd, levelName);
  await fs.ensureDir(dest);
  await fs.copy(srcRoot, dest, { overwrite: true });

  const parent = path.dirname(srcRoot);
  const baseName = path.basename(srcRoot);
  for (const suffix of ["_nether", "_the_end"] as const) {
    const sib = path.join(parent, `${baseName}${suffix}`);
    if (fs.existsSync(sib)) {
      const d = path.join(cwd, `${levelName}${suffix}`);
      await fs.ensureDir(d);
      await fs.copy(sib, d, { overwrite: true });
    }
  }
}
