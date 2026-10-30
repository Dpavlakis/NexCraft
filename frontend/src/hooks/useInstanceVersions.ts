import { modpackVersions, serverVersionsGet } from "@/services/apis/modpack";
import {
  getInstanceVersionTarget,
  installedInstanceVersions,
  orderInstanceReleases,
  selectInstanceUpdate,
  type InstalledPackVersion,
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
    {
      promise: Promise<ReleaseSnapshot>;
      expiresAt: number;
      pending: boolean;
      published?: ReleaseSnapshot;
    }
  >();
  const queue: Array<() => void> = [];
  let active = 0;
  const keyOf = (target: InstanceVersionTarget) =>
    JSON.stringify([target.source, target.projectId]);
  const listeners = new Map<string, Set<(snapshot: ReleaseSnapshot) => void>>();
  const makeRoom = () => {
    if (entries.size < maxSize) return true;
    const victim = [...entries].find(([, value]) => !value.pending);
    if (!victim) return false;
    entries.delete(victim[0]);
    return true;
  };

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
    const key = keyOf(target);
    const existing = entries.get(key);
    if (existing && (existing.pending || existing.expiresAt > now())) {
      entries.delete(key);
      entries.set(key, existing);
      return existing.promise;
    }
    entries.delete(key);
    // Keep pending entries for deduplication; bound both cache and waiting queue.
    if (!makeRoom()) {
      return Promise.resolve({ status: "error", releases: [], expiresAt: now() + ERROR_TTL });
    }
    const entry: {
      promise: Promise<ReleaseSnapshot>;
      expiresAt: number;
      pending: boolean;
      published?: ReleaseSnapshot;
    } = {
      promise: undefined as unknown as Promise<ReleaseSnapshot>,
      expiresAt: 0,
      pending: true
    };
    entry.promise = schedule(async (): Promise<ReleaseSnapshot> => {
      // A dialog may have refreshed a queued badge before it acquired a request slot.
      if (entry.published) return entry.published;
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
        return {
          status: "ready",
          releases: orderInstanceReleases(releases),
          expiresAt: now() + ttl
        };
      } catch {
        return { status: "error", releases: [], expiresAt: now() + ERROR_TTL };
      } finally {
        clearTimeout(timer);
      }
    }).then((snapshot) => {
      // A dialog refresh may finish before an older badge request. Its snapshot wins.
      snapshot = entry.published ?? snapshot;
      entry.pending = false;
      entry.expiresAt = snapshot.expiresAt;
      return snapshot;
    });
    entries.set(key, entry);
    return entry.promise;
  };
  const publish = (target: InstanceVersionTarget, releases: readonly InstanceRelease[]) => {
    const key = keyOf(target);
    const snapshot: ReleaseSnapshot = {
      status: "ready",
      releases: orderInstanceReleases(releases),
      expiresAt: now() + ttl
    };
    const entry = entries.get(key);
    if (entry) {
      entry.published = snapshot;
      entry.expiresAt = snapshot.expiresAt;
      entry.promise = Promise.resolve(snapshot);
      // Keep pending work accounted for until it settles: publication must not grow the queue.
    } else if (makeRoom()) {
      entries.set(key, {
        promise: Promise.resolve(snapshot),
        expiresAt: snapshot.expiresAt,
        pending: false
      });
    }
    listeners.get(key)?.forEach((listener) => listener(snapshot));
  };
  const subscribe = (
    target: InstanceVersionTarget,
    listener: (snapshot: ReleaseSnapshot) => void
  ) => {
    const key = keyOf(target);
    const peers = listeners.get(key) ?? new Set();
    peers.add(listener);
    listeners.set(key, peers);
    return () => {
      peers.delete(listener);
      if (!peers.size) listeners.delete(key);
    };
  };
  return { get, publish, subscribe };
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

/**
 * After the dialog's request/target fence, assign its rows through this single call:
 * versions.value = publishInstanceVersions(pack, rows).
 * Both consumers then share canonical provider ordering, without another HTTP request.
 */
export function publishInstanceVersions<T extends InstanceRelease>(
  pack: InstalledPackVersion | undefined,
  releases: readonly T[]
): T[] {
  const ordered = orderInstanceReleases(releases);
  const target = getInstanceVersionTarget(pack);
  if (target) releaseCache.publish(target, ordered);
  return ordered;
}

export function useInstanceVersions(instance: () => InstanceDetail) {
  const installed = computed(() =>
    installedInstanceVersions(instance().config.packInfo, instance().info)
  );
  const update = shallowRef<InstanceUpdateResult>({ status: "unknown" });
  let disposed = false;
  let request = 0;
  let unsubscribe: (() => void) | undefined;
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

  const apply = (snapshot: ReleaseSnapshot) => {
    clearTimeout(timer);
    update.value =
      snapshot.status === "error"
        ? { status: "error" }
        : selectInstanceUpdate(instance().config.packInfo, snapshot.releases);
    timer = setTimeout(check, Math.max(250, snapshot.expiresAt - Date.now()));
  };
  const check = async () => {
    if (disposed) return;
    const generation = ++request;
    clearTimeout(timer);
    unsubscribe?.();
    unsubscribe = undefined;
    const pack = instance().config.packInfo;
    const target = getInstanceVersionTarget(pack);
    const installedId = pack?.source === "bedrock" ? pack.mcVersion : pack?.fileId;
    if (!target || !installedId) {
      update.value = selectInstanceUpdate(pack, []);
      return;
    }
    unsubscribe = releaseCache.subscribe(target, (snapshot) => {
      const currentTarget = getInstanceVersionTarget(instance().config.packInfo);
      if (
        disposed ||
        currentTarget?.source !== target.source ||
        currentTarget?.projectId !== target.projectId
      )
        return;
      ++request;
      apply(snapshot);
    });
    update.value = { status: "loading" };
    const snapshot = await releaseCache.get(target);
    if (disposed || generation !== request) return;
    apply(snapshot);
  };
  watch(fingerprint, check, { immediate: true });
  onBeforeUnmount(() => {
    disposed = true;
    ++request;
    clearTimeout(timer);
    unsubscribe?.();
  });
  return { installed, update };
}
