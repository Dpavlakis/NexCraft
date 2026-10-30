export type ModTarget = Readonly<{ daemonId: string; instanceUuid: string }>;

export function resolveModTarget(method: string, query: any, body: any): ModTarget {
  const read = (source: any, key: string): string | undefined => {
    const value = source?.[key];
    if (value == null || value === "") return undefined;
    // Do not coerce arrays or objects into authorization IDs.
    if (typeof value !== "string" || !value.trim()) throw new Error("Invalid mod target ID");
    return value;
  };
  const ids: Record<string, string> = {};
  for (const key of ["daemonId", "uuid"]) {
    const queryId = read(query, key);
    const bodyId = read(body, key);
    if (queryId !== undefined && bodyId !== undefined && queryId !== bodyId)
      throw new Error("Conflicting mod target IDs");
    const value = method.toUpperCase() === "GET" ? queryId : bodyId;
    if (value === undefined) throw new Error("Missing mod target ID");
    ids[key] = value;
  }
  return Object.freeze({ daemonId: ids.daemonId, instanceUuid: ids.uuid });
}
