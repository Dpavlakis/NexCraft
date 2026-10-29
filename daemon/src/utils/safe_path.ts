import fs from "fs";
import path from "path";

/** Resolve a target under root, rejecting links (including dangling links).
 * The configured root itself is checked; its ancestors are trusted deployment
 * configuration (e.g. mounted instance storage). Missing children are allowed.
 * This is a point-in-time check, not an atomic defence against directory swaps.
 */
export function assertSafePath(root: string, target: string): string {
  if (typeof root !== "string" || typeof target !== "string" || root.includes("\0") || target.includes("\0"))
    throw new Error("Invalid filesystem path");
  // Treat both separators as separators even on POSIX. Reject foreign drive/UNC
  // syntax rather than allowing it to become an ordinary POSIX filename.
  if (process.platform !== "win32" && (/^[a-z]:/i.test(target) || target.startsWith("\\") || target.startsWith("//")))
    throw new Error("Foreign absolute path");
  if (/^[a-z]:(?![\\/])/i.test(target)) throw new Error("Drive-relative paths are not allowed");
  const base = path.resolve(root);
  const portable = target.replace(/\\/g, "/");
  const resolved = path.resolve(base, portable);
  const relative = path.relative(base, resolved);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    throw new Error("Path escapes filesystem root");
  // Windows alternate streams and Win32 trailing-dot/space aliases are not
  // ordinary directory components; never let them bypass component checks.
  if (process.platform === "win32" && relative.split(path.sep).some((part) => /:|[. ]$/.test(part)))
    throw new Error("Invalid Windows path component");
  let current = base;
  for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Symbolic links and junctions are not allowed");
    } catch (error: any) {
      if (error.code === "ENOENT") break;
      throw error;
    }
  }
  return resolved;
}

/** Validate without rewriting: world names are single portable basenames. */
export function validateWorldName(name: string): string {
  if (typeof name !== "string" || !name.trim() || name === "." || name === ".." ||
      /[\\/\0\r\n:]/.test(name) || path.posix.isAbsolute(name) || path.win32.isAbsolute(name) ||
      /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    throw new Error("Invalid world directory name");
  return name;
}
