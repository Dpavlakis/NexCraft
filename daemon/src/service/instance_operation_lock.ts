// Process-local, fail-fast serialization. Acquire before the first await.
const operations = new Set<string>();
export function acquireInstanceOperation(uuid: string): () => void {
  if (operations.has(uuid)) throw new Error("Another world or backup operation is already running for this instance");
  operations.add(uuid);
  let released = false;
  return () => { if (!released) { released = true; operations.delete(uuid); } };
}
