import fs from "fs-extra";
import path from "path";

// CurseForge strips these bytes before hashing.
function stripWhitespace(buf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 9 || b === 10 || b === 13 || b === 32) continue;
    out[n++] = b;
  }
  return out.subarray(0, n);
}

// murmur2 (32-bit), CurseForge uses seed = 1.
function murmur2(data: Buffer, seed = 1): number {
  const m = 0x5bd1e995;
  const r = 24;
  let len = data.length;
  let h = (seed ^ len) >>> 0;
  let i = 0;
  while (len >= 4) {
    let k =
      (data[i] & 0xff) |
      ((data[i + 1] & 0xff) << 8) |
      ((data[i + 2] & 0xff) << 16) |
      ((data[i + 3] & 0xff) << 24);
    k = Math.imul(k, m) >>> 0;
    k = (k ^ (k >>> r)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    h = Math.imul(h, m) >>> 0;
    h = (h ^ k) >>> 0;
    i += 4;
    len -= 4;
  }
  if (len === 3) h = (h ^ ((data[i + 2] & 0xff) << 16)) >>> 0;
  if (len >= 2) h = (h ^ ((data[i + 1] & 0xff) << 8)) >>> 0;
  if (len >= 1) {
    h = (h ^ (data[i] & 0xff)) >>> 0;
    h = Math.imul(h, m) >>> 0;
  }
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, m) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

export function fingerprintFile(absPath: string): number {
  return murmur2(stripWhitespace(fs.readFileSync(absPath)));
}

// Fingerprint every top-level *.jar in <dir>/mods (CurseForge matching input).
export function fingerprintMods(instanceDir: string): number[] {
  const modsDir = path.join(instanceDir, "mods");
  if (!fs.existsSync(modsDir)) return [];
  const out: number[] = [];
  for (const name of fs.readdirSync(modsDir)) {
    if (!name.toLowerCase().endsWith(".jar")) continue;
    const p = path.join(modsDir, name);
    try {
      if (fs.statSync(p).isFile()) out.push(fingerprintFile(p));
    } catch {
      // ignore unreadable files
    }
  }
  return out;
}
