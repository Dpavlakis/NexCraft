import { SecurityError } from "./security_error";
// Retain queue identity until its final waiter exits; never delete a lock with waiters.
const operations = new Map<string, { tail: Promise<void>; count: number }>();
let outstanding = 0;
export async function userOperation<T>(uuid: string, work: () => Promise<T>): Promise<T> {
  if (outstanding >= 2048 || (operations.get(uuid)?.count || 0) >= 32)
    throw new SecurityError(409, "Account operation busy; retry");
  let queue = operations.get(uuid);
  if (!queue) {
    queue = { tail: Promise.resolve(), count: 0 };
    operations.set(uuid, queue);
  }
  const before = queue.tail;
  let release!: () => void;
  queue.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  queue.count++;
  outstanding++;
  await before;
  try {
    return await work();
  } finally {
    release();
    outstanding--;
    if (--queue.count === 0) operations.delete(uuid);
  }
}
