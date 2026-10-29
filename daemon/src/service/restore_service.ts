import fs from "fs-extra";
import path from "path";
import StreamZip from "node-stream-zip";
import { v4 } from "uuid";
import { assertSafePath, validateWorldName } from "../utils/safe_path";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

// Validate all names and types before writing anything. Extracting every file also
// checks CRC/decompression before the caller stops the server.
export async function extractValidatedArchive(archive: string, stage: string, cwd: string) {
  assertSafePath(path.dirname(archive), archive);
  assertSafePath(path.dirname(stage), stage);
  await fs.mkdir(stage);
  const zip = new StreamZip.async({ file: archive });
  let failed = false;
  try {
    const entries = Object.values(await zip.entries());
    const seen = new Set<string>();
    for (const entry of entries) {
      const name = entry.name.replace(/\/$/, "");
      if (!name || entry.name.includes("\\") || path.posix.isAbsolute(name) ||
          name.split("/").some((part) => !part || part === "." || part === ".." || /[:\x00-\x1f]/.test(part)))
        throw new Error("Unsafe archive entry: " + entry.name);
      name.split("/").forEach(validateWorldName);
      const key = name.toLowerCase();
      if (seen.has(key)) throw new Error("Duplicate archive entry: " + name);
      seen.add(key);
      const type = (entry.attr >>> 16) & 0o170000;
      if (type !== 0 && type !== (entry.isDirectory ? 0o040000 : 0o100000))
        throw new Error("Unsupported archive entry type: " + name);
      assertSafePath(stage, path.join(stage, name));
      assertSafePath(cwd, path.join(cwd, name));
    }
    for (const entry of entries) {
      const dest = assertSafePath(stage, path.join(stage, entry.name));
      if (entry.isDirectory) await fs.ensureDir(dest);
      else {
        await fs.ensureDir(path.dirname(dest));
        await zip.extract(entry.name, dest);
        // node-stream-zip skips CRC checks for data-descriptor entries (bit 3),
        // including archives produced by archiver. Verify all staged bytes here.
        let crc = 0xffffffff;
        let size = 0;
        for await (const chunk of fs.createReadStream(dest)) {
          const bytes = chunk as Buffer;
          size += bytes.length;
          for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
        }
        if (((crc ^ 0xffffffff) >>> 0) !== (entry.crc >>> 0) || size !== entry.size)
          throw new Error("Corrupt archive entry: " + entry.name);
      }
    }
    if (!entries.length) throw new Error("Empty restore archive");
  } catch (error) { failed = true; throw error; }
  finally {
    try { await zip.close(); } catch (error) { if (!failed) throw error; }
  }
}

// Full archives replace ONLY covered top-level units. Excluded/absent top-level
// paths survive; exclusions inside a covered directory do not survive replacement.
// World archives require both the world- prefix and world metadata/structure.
export function restoreUnits(stage: string, archive: string): string[] {
  const tops = fs.readdirSync(stage);
  if (!path.basename(archive).startsWith("world-")) return tops;
  const units: string[] = [];
  const hasLevelDat = (name: string) => {
    const dir = path.join(stage, name);
    return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, "level.dat")) &&
      fs.statSync(path.join(dir, "level.dat")).isFile();
  };
  if (tops.includes("worlds")) {
    if (tops.length !== 1) throw new Error("Mixed world backup structure");
    for (const name of fs.readdirSync(path.join(stage, "worlds"))) {
      const unit = `worlds/${validateWorldName(name)}`;
      if (!hasLevelDat(unit)) throw new Error("Invalid Bedrock world backup: " + unit);
      units.push(unit);
    }
  } else {
    const primary = tops.filter(hasLevelDat);
    if (!primary.length) throw new Error("World backup has no primary level.dat");
    const allowed = new Set(primary.flatMap(name => [name, `${name}_nether`, `${name}_the_end`]));
    for (const name of tops) {
      validateWorldName(name);
      if (!allowed.has(name) || !fs.statSync(path.join(stage, name)).isDirectory())
        throw new Error("Invalid Java world backup: " + name);
      units.push(name);
    }
  }
  if (!units.length) throw new Error("Empty world backup");
  return units;
}

export async function prepareRestore(archive: string, cwd: string) {
  const stage = assertSafePath(path.dirname(cwd), path.join(path.dirname(cwd), `.nexcraft-restore-${v4()}`));
  try {
    await extractValidatedArchive(archive, stage, cwd);
    return { stage, units: restoreUnits(stage, archive) };
  } catch (error) { await fs.remove(stage); throw error; }
}

export async function applyRestore(stage: string, cwd: string, units: string[]) {
  const rollback = assertSafePath(path.dirname(cwd), path.join(path.dirname(cwd), `.nexcraft-rollback-${v4()}`));
  await fs.mkdir(rollback);
  const applied: Array<{ name: string; saved: boolean; installed: boolean }> = [];
  try {
    for (const name of units) {
      const dest = assertSafePath(cwd, path.join(cwd, name));
      const savedPath = assertSafePath(rollback, path.join(rollback, name));
      const item = { name, saved: false, installed: false };
      applied.push(item);
      await fs.ensureDir(path.dirname(savedPath));
      if (fs.existsSync(dest)) { await fs.rename(dest, savedPath); item.saved = true; }
      await fs.ensureDir(path.dirname(dest));
      await fs.rename(assertSafePath(stage, path.join(stage, name)), dest);
      item.installed = true;
    }
  } catch (error: any) {
    const failures: string[] = [];
    for (const item of applied.reverse()) {
      try {
        const dest = assertSafePath(cwd, path.join(cwd, item.name));
        if (item.installed) await fs.remove(dest);
        if (item.saved) await fs.rename(path.join(rollback, item.name), dest);
      } catch (failure: any) { failures.push(failure.message); }
    }
    if (failures.length) throw new Error(`${error.message}; rollback incomplete, recovery data retained at ${rollback}: ${failures.join("; ")}`);
    await fs.remove(rollback);
    throw error;
  }
  await fs.remove(rollback);
}
