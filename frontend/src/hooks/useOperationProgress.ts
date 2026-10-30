import { onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { OperationTask } from "@/tools/operationProgress";

export type OperationFailure = "start" | "missing" | "failed" | "unavailable";

// Owns a single start + recursive poll chain. Writes are never retried automatically.
export function useOperationProgress<T extends OperationTask>(
  target: () => string,
  read: (taskId: string) => Promise<T | null | undefined>,
  interval = 1500
) {
  const busy = ref(false);
  const task = shallowRef<T | null>(null);
  const failure = ref<OperationFailure>();
  let generation = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const invalidate = () => {
    ++generation;
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

  const start = async (
    create: () => Promise<string>,
    callbacks: {
      onStarted?: () => void;
      onSuccess: (task: T) => void;
      onFailure?: (reason: OperationFailure, error?: unknown) => void;
    }
  ) => {
    if (disposed || busy.value) return;
    invalidate();
    const ownGeneration = generation;
    const ownTarget = target();
    const current = () => !disposed && generation === ownGeneration && target() === ownTarget;
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
    callbacks.onStarted?.();

    const poll = async () => {
      if (!current()) return;
      let result: T | null | undefined;
      try {
        result = await read(taskId);
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
  return { busy, task, failure, start };
}
