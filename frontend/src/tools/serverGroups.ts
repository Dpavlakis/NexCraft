export type ServerGroupKind = "modpack" | "custom";
export const SERVER_GROUP_KINDS: ServerGroupKind[] = ["modpack", "custom"];

export function serverGroupKind(source: unknown): ServerGroupKind {
  return source === "curseforge" || source === "modrinth" || source === "ftb"
    ? "modpack"
    : "custom";
}

export function groupServers<T>(items: readonly T[], sourceFor: (item: T) => unknown) {
  return SERVER_GROUP_KINDS.map((kind) => ({
    kind,
    items: items.filter((item) => serverGroupKind(sourceFor(item)) === kind)
  }));
}
