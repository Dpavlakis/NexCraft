import { onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { OperationTask } from "@/tools/operationProgress";

export type OperationFailure = "start" | "missing" | "failed" | "unavailable";

// Owns a single start + recursive poll chain. Writes are never retried automatically.
export function useOperationProgress<T extends OperationTask>(
  target: () => string,
  read: (taskId: string, signal?: AbortSignal) => Promise<T | null | undefined>,
  interval = 1500
) {
  const busy = ref(false);
  const task = shallowRef<T | null>(null);
  const failure = ref<OperationFailure>();
  let generation = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const invalidate = () => {
    ++generation;
    controller?.abort();
    controller = undefined;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    busy.value = false;
    task.value = null;
    failure.value = undefined;
  };
  watch(target, invalidate, { flush: "sync" });
  onBeforeUnmount(() => {
    disposed = true;
    invalidate();
  });

  type Callbacks = {
    onStarted?: () => void;
    onSuccess: (task: T) => void;
    onFailure?: (reason: OperationFailure, error?: unknown) => void;
  };
  const run = async (
    create: () => Promise<string>,
    callbacks: Callbacks,
    existing?: T
  ) => {
    if (disposed || busy.value) return;
    invalidate();
    const ownGeneration = generation;
    const ownTarget = target();
    const current = () => !disposed && generation === ownGeneration && target() === ownTarget;
    controller = new AbortController();
    const signal = controller.signal;
    busy.value = true; // Synchronous: includes the pending POST, before the first await.
    const fail = (reason: OperationFailure, error?: unknown) => {
      if (!current()) return;
      busy.value = false;
      failure.value = reason;
      callbacks.onFailure?.(reason, error);
    };
    let taskId: string;
    try {
      taskId = await create();
      if (!current()) return;
      if (!taskId) {
        fail("start");
        return;
      }
    } catch (error) {
      fail("start", error);
      return;
    }
    if (!existing) callbacks.onStarted?.();

    const poll = async () => {
      if (!current()) return;
      let result: T | null | undefined;
      try {
        // Discovery already supplied the first snapshot. Continue with the same poll chain.
        result = existing ?? (await read(taskId, signal));
        existing = undefined;
      } catch (error) {
        fail("unavailable", error);
        return;
      }
      if (!current()) return;
      if (!result || result.taskId !== taskId) {
        fail("missing");
        return;
      }
      task.value = result;
      if (result.status === 1) {
        timer = setTimeout(poll, interval);
      } else if (result.status === 0 && result.progress?.completed !== false) {
        busy.value = false;
        callbacks.onSuccess(result);
      } else {
        fail("failed");
      }
    };
    await poll();
  };
  const start = (create: () => Promise<string>, callbacks: Callbacks) => run(create, callbacks);
  // Attaching only observes an existing task and never emits the start notification.
  const attach = (existing: T, callbacks: Omit<Callbacks, "onStarted">) =>
    run(async () => existing.taskId, callbacks, existing);
  return { busy, task, failure, start, attach, reset: invalidate };
}
