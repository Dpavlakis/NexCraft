import { modpackVersions, serverVersionsGet } from "@/services/apis/modpack";
import {
  getInstanceVersionTarget,
  installedInstanceVersions,
  selectInstanceUpdate,
  type InstanceRelease,
  type InstanceUpdateResult,
  type InstanceVersionTarget
} from "@/tools/instanceVersions";
import type { InstanceDetail } from "@/types";
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";

export const INSTANCE_VERSIONS_TTL = 10 * 60 * 1000;
const ERROR_TTL = 60 * 1000;
export const INSTANCE_VERSIONS_TIMEOUT = 30 * 1000;

interface ReleaseSnapshot {
  status: "ready" | "error";
  releases: readonly InstanceRelease[];
  expiresAt: number;
}

/** Dependency injection keeps the cache testable without a frontend runtime or network. */
export function createInstanceVersionCache(
  load: (target: InstanceVersionTarget, signal: AbortSignal) => Promise<readonly InstanceRelease[]>,
  options: {
    now?: () => number;
    ttl?: number;
    maxSize?: number;
    concurrency?: number;
    timeout?: number;
  } = {}
) {
  const now = options.now || Date.now;
  const ttl = options.ttl ?? INSTANCE_VERSIONS_TTL;
  const timeout = Math.max(1, options.timeout ?? INSTANCE_VERSIONS_TIMEOUT);
  const maxSize = Math.max(1, options.maxSize ?? 100);
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const entries = new Map<
    string,
    { promise: Promise<ReleaseSnapshot>; expiresAt: number; pending: boolean }
  >();
  const queue: Array<() => void> = [];
  let active = 0;

  const schedule = <T>(job: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const run = () => {
        active++;
        Promise.resolve()
          .then(job)
          .then(resolve, reject)
          .finally(() => {
            active--;
            queue.shift()?.();
          });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });

  const get = (target: InstanceVersionTarget): Promise<ReleaseSnapshot> => {
    const key = JSON.stringify([target.source, target.projectId]);
    const existing = entries.get(key);
    if (existing && (existing.pending || existing.expiresAt > now())) {
      entries.delete(key);
      entries.set(key, existing);
      return existing.promise;
    }
    entries.delete(key);
    // Keep pending entries for deduplication; bound both cache and waiting queue.
    if (entries.size >= maxSize) {
      const victim = [...entries].find(([, value]) => !value.pending);
      if (victim) entries.delete(victim[0]);
      else return Promise.resolve({ status: "error", releases: [], expiresAt: now() + ERROR_TTL });
    }
    const entry = {
      promise: undefined as unknown as Promise<ReleaseSnapshot>,
      expiresAt: 0,
      pending: true
    };
    entry.promise = schedule(async (): Promise<ReleaseSnapshot> => {
      // The cache owns cancellation: one consumer unmounting must not cancel peers.
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Also bound injected loaders that ignore AbortSignal or never settle.
        const releases = await Promise.race([
          Promise.resolve().then(() => load(target, controller.signal)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error("Version list timed out"));
              controller.abort();
            }, timeout);
          })
        ]);
        if (!Array.isArray(releases)) throw new Error("Version list unavailable");
        return { status: "ready", releases: releases.slice(), expiresAt: now() + ttl };
      } catch {
        return { status: "error", releases: [], expiresAt: now() + ERROR_TTL };
      } finally {
        clearTimeout(timer);
      }
    }).then((snapshot) => {
      entry.pending = false;
      entry.expiresAt = snapshot.expiresAt;
      return snapshot;
    });
    entries.set(key, entry);
    return entry.promise;
  };
  return { get };
}

const releaseCache = createInstanceVersionCache(async (target, signal) => {
  const response =
    target.source === "bedrock"
      ? await serverVersionsGet().execute({
          params: { software: "bedrock" },
          forceRequest: true,
          timeout: INSTANCE_VERSIONS_TIMEOUT,
          signal
        })
      : await modpackVersions().execute({
          params: { source: target.source, projectId: target.projectId },
          forceRequest: true,
          timeout: INSTANCE_VERSIONS_TIMEOUT,
          signal
        });
  if (!Array.isArray(response.value)) throw new Error("Version list unavailable");
  return response.value;
});

export function useInstanceVersions(instance: () => InstanceDetail) {
  const installed = computed(() =>
    installedInstanceVersions(instance().config.packInfo, instance().info)
  );
  const update = shallowRef<InstanceUpdateResult>({ status: "unknown" });
  let disposed = false;
  let request = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Polling replaces InstanceDetail every few seconds. Watch only stable provenance fields.
  const fingerprint = computed(() => {
    const value = instance();
    const pack = value.config.packInfo;
    return JSON.stringify([
      value.instanceUuid,
      pack?.source,
      pack?.projectId,
      pack?.fileId,
      pack?.versionName,
      pack?.mcVersion,
      pack?.loader
    ]);
  });

  const check = async () => {
    if (disposed) return;
    const generation = ++request;
    clearTimeout(timer);
    const pack = instance().config.packInfo;
    const target = getInstanceVersionTarget(pack);
    const installedId = pack?.source === "bedrock" ? pack.mcVersion : pack?.fileId;
    if (!target || !installedId) {
      update.value = selectInstanceUpdate(pack, []);
      return;
    }
    update.value = { status: "loading" };
    const snapshot = await releaseCache.get(target);
    if (disposed || generation !== request) return;
    update.value =
      snapshot.status === "error"
        ? { status: "error" }
        : selectInstanceUpdate(pack, snapshot.releases);
    timer = setTimeout(check, Math.max(250, snapshot.expiresAt - Date.now()));
  };
  watch(fingerprint, check, { immediate: true });
  onBeforeUnmount(() => {
    disposed = true;
    ++request;
    clearTimeout(timer);
  });
  return { installed, update };
}
