export type BackupKind = "world" | "server" | "unknown";

// Backend timestamps are YYYYMMDD-HHmmss. Older backups lack the UUID suffix;
// uncompressed backups can be directories with the same name and no extension.
const generatedName =
  /^(world|backup)-\d{8}-\d{6}(?:-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})?(?:\.zip)?$/i;
export function backupKind(name: string): BackupKind {
  const match = generatedName.exec(name);
  if (!match || match[0] !== name) return "unknown";
  return match[1].toLowerCase() === "world" ? "world" : "server";
}

export function backupSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "–";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** Math.max(0, index)).toFixed(index > 0 ? 2 : 0)} ${
    units[Math.max(0, index)]
  }`;
}

export function backupTime(ms: number): string {
  return ms > 0 && Number.isFinite(ms) && !Number.isNaN(new Date(ms).getTime())
    ? new Date(ms).toLocaleString()
    : "–";
}
