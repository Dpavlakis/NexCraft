import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import {
  instanceReleaseId,
  orderInstanceReleases,
  selectInstanceUpdate,
  type InstanceRelease
} from "@/tools/instanceVersions";

const api = vi.hoisted(() => ({ execute: vi.fn(), navigate: vi.fn() }));
vi.mock("@/lang/i18n", () => ({
  t: (key: string) =>
    (
      ({
        TXT_CODE_instance_version_up_to_date: "Up to date",
        TXT_CODE_instance_version_status_unknown: "Unknown",
        TXT_CODE_instance_version_update_available: "Update available"
      }) as Record<string, string>
    )[key] || key
}));
vi.mock("@/stores/useAppStateStore", () => ({
  useAppStateStore: () => ({ isAdmin: { value: true } })
}));
vi.mock("@/hooks/useAppRouters", () => ({ useAppRouters: () => ({ toPage: api.navigate }) }));
vi.mock("@/services/apis/modpack", () => ({
  modpackVersions: () => ({ execute: api.execute }),
  serverVersionsGet: () => ({ execute: api.execute })
}));
import InstanceVersionInfo from "@/components/InstanceVersionInfo.vue";
import {
  createInstanceVersionCache,
  publishInstanceVersions,
  useInstanceVersions
} from "@/hooks/useInstanceVersions";

// Official file pages, projected onto the panel's normalized version-list shape.
// Dates have day precision; these are controlled snapshots, not a live latest-version assertion.
// https://www.curseforge.com/minecraft/modpacks/all-the-mods-10/files/8945086
// https://www.curseforge.com/minecraft/modpacks/all-the-mods-10/files/9190157
const atm82: InstanceRelease = {
  fileId: "8945086",
  displayName: "All the Mods 10-8.2",
  mcVersion: "1.21.1",
  loader: "neoforge",
  hasServerPack: true,
  releaseType: 1,
  fileDate: "2026-09-22"
};
const atm83: InstanceRelease = {
  ...atm82,
  fileId: "9190157",
  displayName: "All the Mods 10-8.3",
  fileDate: "2026-10-15"
};
const legacy = {
  source: "curseforge",
  projectId: "925200",
  fileId: "8945086",
  versionName: "All the Mods 10-8.2",
  mcVersion: "1.21.1",
  loader: "vanilla"
};
const wrappers: VueWrapper[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  api.execute.mockReset();
});
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("provider identity versus update status", () => {
  it("reproduces the dialog's exact current ID but resolves legacy CF metadata as current", () => {
    expect(instanceReleaseId(atm82, legacy.source)).toBe(legacy.fileId);
    expect(selectInstanceUpdate(legacy, [atm82])).toEqual({ status: "current" });
    expect(legacy.loader).toBe("vanilla");
  });
  it("uses the matched release's loader to find a newer compatible server pack", () => {
    expect(selectInstanceUpdate(legacy, [atm82, atm83])).toEqual({
      status: "available",
      latest: atm83
    });
    expect(selectInstanceUpdate({ ...legacy, fileId: atm83.fileId }, [atm83, atm82]).status).toBe(
      "current"
    );
  });
});

const target = { source: "curseforge" as const, projectId: "925200" };
const mr = (id: string, extra: Partial<InstanceRelease> = {}): InstanceRelease => ({
  id,
  game_versions: ["1.21.1"],
  loaders: ["fabric"],
  version_type: "release",
  ...extra
});
const mrPack = { ...legacy, source: "modrinth", fileId: "opaque", loader: "fabric" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
let sequence = 0;
function mountedPack(extra: Record<string, unknown> = {}, component = false) {
  const pack = { ...legacy, projectId: "isolated-" + ++sequence, ...extra };
  const instance = reactive({
    instanceUuid: "fixture",
    info: {},
    config: { packInfo: pack }
  }) as any;
  const wrapper = component
    ? mount(InstanceVersionInfo, { props: { instance, daemonId: "fixture-node" } })
    : mount(
        defineComponent({
          setup() {
            const { update } = useInstanceVersions(() => instance);
            return () => h("span", update.value.status);
          }
        })
      );
  wrappers.push(wrapper);
  return { pack, instance, wrapper };
}

describe("conservative comparison and canonical release ordering", () => {
  it("keeps a legacy CF loader unknown when its exact release supports distinct loaders", () => {
    const current = { ...atm82, loaders: ["Forge", "NeoForge"] };
    for (const loader of ["forge", "neoforge"]) {
      expect(selectInstanceUpdate(legacy, [{ ...atm83, loader }, current])).toEqual({
        status: "unknown"
      });
    }
    // Keep this fallback conservative even without a candidate; no server loader was resolved.
    expect(selectInstanceUpdate(legacy, [current])).toEqual({ status: "unknown" });
    expect(legacy.loader).toBe("vanilla");
  });
  it("resolves duplicate case-folded CF loader tags as one authoritative loader", () => {
    const current = { ...atm82, loaders: ["NeoForge", "neoforge", "NEOFORGE"] };
    expect(selectInstanceUpdate(legacy, [current])).toEqual({ status: "current" });
    expect(selectInstanceUpdate(legacy, [atm83, current])).toEqual({
      status: "available",
      latest: atm83
    });
  });
  it("uses a concrete persisted loader with a release supporting multiple loaders", () => {
    const current = { ...atm82, loaders: ["Forge", "NeoForge"] };
    const installed = { ...legacy, loader: "NeoForge" };
    expect(selectInstanceUpdate(installed, [current])).toEqual({ status: "current" });
    expect(selectInstanceUpdate(installed, [atm83, current])).toEqual({
      status: "available",
      latest: atm83
    });
    expect(selectInstanceUpdate({ ...installed, loader: "fabric" }, [atm83, current])).toEqual({
      status: "unknown"
    });
  });
  it.each([
    ["missing installed ID", { ...legacy, fileId: "" }, [atm82]],
    ["absent installed release", { ...legacy, fileId: "not-in-page" }, [atm82]],
    ["empty response", legacy, []],
    ["missing project", { ...legacy, projectId: "" }, [atm82]],
    ["missing channel", legacy, [{ ...atm82, releaseType: undefined }]],
    ["missing loader evidence", legacy, [{ ...atm82, loader: undefined }]],
    ["CF parser fallback is not a real loader", legacy, [{ ...atm82, loader: "vanilla" }]],
    ["missing game version", { ...legacy, mcVersion: "" }, [{ ...atm82, mcVersion: undefined }]],
    ["concrete loader conflict", { ...legacy, loader: "forge" }, [atm82]],
    ["concrete game version conflict", { ...legacy, mcVersion: "1.20.1" }, [atm82]]
  ])("keeps %s unknown", (_label, pack, releases) => {
    expect(selectInstanceUpdate(pack as typeof legacy, releases as InstanceRelease[]).status).toBe(
      "unknown"
    );
  });
  it.each([
    ["missing channel", { releaseType: undefined }],
    ["missing MC", { mcVersion: undefined }],
    ["missing loader", { loader: undefined }],
    ["defaulted CF loader", { loader: "vanilla" }],
    ["missing server-pack evidence", { hasServerPack: undefined }],
    ["missing provider ID", { fileId: undefined }],
    ["equal release dates", { fileDate: atm82.fileDate }]
  ])("does not turn an incomplete newer release (%s) green", (_label, extra) => {
    expect(selectInstanceUpdate(legacy, [{ ...atm83, ...extra }, atm82]).status).toBe("unknown");
  });
  it.each([
    { loader: "forge" },
    { mcVersion: "1.22" },
    { releaseType: 2 },
    { hasServerPack: false }
  ])("ignores a definitely incompatible or uninstallable candidate: %j", (extra) => {
    expect(selectInstanceUpdate(legacy, [{ ...atm83, ...extra }, atm82]).status).toBe("current");
  });
  it("does not treat Modrinth vanilla as a legacy CF fallback", () => {
    expect(selectInstanceUpdate({ ...mrPack, loader: "vanilla" }, [mr("opaque")]).status).toBe(
      "unknown"
    );
  });
  it("shares provider IDs and published ordering without mutating data or sorting names", () => {
    const rows = [atm82, { ...atm83, displayName: "An older looking name 0.0" }];
    const ordered = orderInstanceReleases(rows);
    expect(ordered.map((row) => instanceReleaseId(row, "curseforge"))).toEqual([
      atm83.fileId,
      atm82.fileId
    ]);
    expect(rows[0]).toBe(atm82);
    const noDates = [mr("z", { name: "0.1" }), mr("opaque", { name: "9999.0" })];
    expect(selectInstanceUpdate(mrPack, noDates)).toEqual({
      status: "available",
      latest: noDates[0]
    });
    expect(selectInstanceUpdate({ ...mrPack, fileId: "z" }, noDates).status).toBe("current");
  });
  it("does not contradict known publication dates when other rows are undated", () => {
    const current = mr("opaque", { date_published: "2026-10-15" });
    const older = mr("z", { date_published: "2026-09-22" });
    expect(selectInstanceUpdate(mrPack, [older, current, mr("undated")]).status).toBe("current");
  });
  it("keeps capability separate from current status, including Bedrock", () => {
    expect(selectInstanceUpdate({ ...legacy, source: "ftb" }, []).status).toBe("unsupported");
    expect(
      selectInstanceUpdate({ source: "bedrock", mcVersion: "absent" }, [
        { id: "present", type: "release" }
      ]).status
    ).toBe("unknown");
    expect(
      selectInstanceUpdate({ source: "bedrock", mcVersion: "present" }, [
        { id: "present", type: "release" }
      ]).status
    ).toBe("current");
  });
});

describe("bounded project cache and explicit refreshed snapshots", () => {
  it("deduplicates requests, shares data per installed ID, and expires only at ten minutes", async () => {
    const gate = deferred<InstanceRelease[]>();
    const load = vi.fn(() => gate.promise);
    const cache = createInstanceVersionCache(load);
    const a = cache.get(target);
    expect(cache.get({ ...target })).toBe(a);
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);
    gate.resolve([atm83, atm82]);
    const snapshot = await a;
    expect(selectInstanceUpdate(legacy, snapshot.releases).status).toBe("available");
    expect(
      selectInstanceUpdate({ ...legacy, fileId: atm83.fileId }, snapshot.releases).status
    ).toBe("current");
    await vi.advanceTimersByTimeAsync(599999);
    expect(await cache.get(target)).toBe(snapshot);
    await vi.advanceTimersByTimeAsync(1);
    expect(await cache.get(target)).not.toBe(snapshot);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("publishes a narrow provider/project snapshot immediately and fences an older request", async () => {
    const gate = deferred<InstanceRelease[]>();
    const load = vi.fn(() => gate.promise);
    const cache = createInstanceVersionCache(load);
    const receive = vi.fn();
    const other = vi.fn();
    const unsubscribe = cache.subscribe(target, receive);
    cache.subscribe({ ...target, source: "modrinth" }, other);
    cache.subscribe({ ...target, projectId: "another" }, other);
    const pending = cache.get(target);
    await flushPromises();
    cache.publish(target, [atm82, atm83]);
    expect(receive).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect((await cache.get(target)).releases[0]).toEqual(atm83);
    gate.resolve([]);
    expect((await pending).releases[0]).toEqual(atm83);
    expect((await cache.get(target)).releases[0]).toEqual(atm83);
    expect(load).toHaveBeenCalledTimes(1);
    unsubscribe();
    cache.publish(target, [atm82]);
    expect(receive).toHaveBeenCalledTimes(1);
  });
  it("replaces an error snapshot without HTTP and retains the short error TTL", async () => {
    const load = vi.fn().mockRejectedValue(new Error("offline"));
    const cache = createInstanceVersionCache(load);
    expect((await cache.get(target)).status).toBe("error");
    await vi.advanceTimersByTimeAsync(59999);
    expect((await cache.get(target)).status).toBe("error");
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await cache.get(target)).status).toBe("error");
    expect(load).toHaveBeenCalledTimes(2);
    cache.publish(target, [atm82]);
    expect((await cache.get(target)).status).toBe("ready");
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("bounds both active requests and queued identities even if refreshed while pending", async () => {
    const gates = Array.from({ length: 3 }, () => deferred<InstanceRelease[]>());
    const load = vi
      .fn()
      .mockImplementationOnce(() => gates[0].promise)
      .mockImplementationOnce(() => gates[1].promise)
      .mockImplementationOnce(() => gates[2].promise);
    const cache = createInstanceVersionCache(load, { concurrency: 1, maxSize: 2 });
    const a = cache.get(target);
    const b = cache.get({ ...target, projectId: "b" });
    await flushPromises();
    cache.publish(target, [atm82]);
    expect((await cache.get({ ...target, projectId: "overflow" })).status).toBe("error");
    expect(load).toHaveBeenCalledTimes(1);
    gates[0].resolve([]);
    await a;
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
    gates[1].resolve([]);
    await b;
    // Once settled, least-recently-used snapshots can be evicted.
    const c = cache.get({ ...target, projectId: "c" });
    await flushPromises();
    gates[2].resolve([]);
    await c;
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("times out stalled loaders, aborts them, and releases the queued seat", async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn((_target, signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1
        ? new Promise<InstanceRelease[]>(() => {})
        : Promise.resolve([atm82]);
    });
    const cache = createInstanceVersionCache(load, { concurrency: 1, timeout: 50 });
    const first = cache.get(target);
    const second = cache.get({ ...target, projectId: "second" });
    await vi.advanceTimersByTimeAsync(50);
    expect((await first).status).toBe("error");
    expect(signals[0].aborted).toBe(true);
    expect((await second).status).toBe("ready");
    expect(load).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("mounted summary and coordinated dialog publication", () => {
  it("renders current and available from evidence, and links the canonical update ID", async () => {
    api.execute.mockResolvedValue({ value: [atm82] });
    const { pack, wrapper } = mountedPack({}, true);
    await flushPromises();
    expect(wrapper.get('[data-status="current"]').text()).toBe("Up to date");
    expect(wrapper.find("button").exists()).toBe(false);
    const rows = publishInstanceVersions(pack, [atm82, atm83]);
    await flushPromises();
    expect(rows).toEqual([atm83, atm82]);
    expect(wrapper.get('[data-status="available"]').text()).toBe("Update available");
    await wrapper.get("button").trigger("click");
    expect(api.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          updateVersionId: "9190157",
          updateSource: "curseforge",
          updateProjectId: pack.projectId
        })
      })
    );
    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(pack.loader).toBe("vanilla");
  });
  it("shows an explicit Unknown for incomplete evidence without an update button", async () => {
    api.execute.mockResolvedValue({ value: [{ ...atm82, loader: "vanilla" }] });
    const { wrapper } = mountedPack({}, true);
    await flushPromises();
    expect(wrapper.get('[data-status="unknown"]').text()).toBe("Unknown");
    expect(wrapper.find("button").exists()).toBe(false);
  });
  it("updates already mounted peers after a refresh, with no extra request or late rollback", async () => {
    const gate = deferred<{ value: InstanceRelease[] }>();
    api.execute.mockReturnValue(gate.promise);
    const first = mountedPack();
    const second = mountedPack({ projectId: first.pack.projectId });
    await flushPromises();
    expect(api.execute).toHaveBeenCalledTimes(1);
    publishInstanceVersions(first.pack, [atm83, atm82]);
    await flushPromises();
    expect(first.wrapper.text()).toBe("available");
    expect(second.wrapper.text()).toBe("available");
    gate.resolve({ value: [] });
    await flushPromises();
    expect(first.wrapper.text()).toBe("available");
    expect(second.wrapper.text()).toBe("available");
    expect(api.execute).toHaveBeenCalledTimes(1);
  });
  it("replaces a stale Unknown before ten minutes and leaves other projects unchanged", async () => {
    api.execute.mockResolvedValue({ value: [] });
    const first = mountedPack();
    const other = mountedPack();
    await flushPromises();
    expect(first.wrapper.text()).toBe("unknown");
    publishInstanceVersions(first.pack, [atm82]);
    await flushPromises();
    expect(first.wrapper.text()).toBe("current");
    expect(other.wrapper.text()).toBe("unknown");
    expect(api.execute).toHaveBeenCalledTimes(2);
  });
  it("ignores poll replacements, recomputes an installed ID change, and uses bounded forced reads", async () => {
    api.execute.mockResolvedValue({ value: [atm83, atm82] });
    const { instance, wrapper } = mountedPack();
    await flushPromises();
    expect(wrapper.text()).toBe("available");
    instance.config.packInfo = { ...instance.config.packInfo };
    instance.info = { version: "unrelated runtime ping" };
    await flushPromises();
    expect(api.execute).toHaveBeenCalledTimes(1);
    instance.config.packInfo = { ...instance.config.packInfo, fileId: atm83.fileId };
    await flushPromises();
    expect(wrapper.text()).toBe("current");
    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(api.execute.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        forceRequest: true,
        timeout: 30000,
        signal: expect.any(AbortSignal)
      })
    );
  });
  it("fences publication across a project change and cleans up on unmount", async () => {
    api.execute.mockResolvedValue({ value: [atm82] });
    const { pack, instance, wrapper } = mountedPack();
    await flushPromises();
    instance.config.packInfo = { ...pack, projectId: "changed-" + ++sequence };
    await flushPromises();
    publishInstanceVersions(pack, [atm83, atm82]);
    await flushPromises();
    expect(wrapper.text()).toBe("current");
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
    publishInstanceVersions(instance.config.packInfo, [atm83, atm82]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("refresh scheduling edge cases", () => {
  it("skips a queued HTTP load already satisfied by dialog publication", async () => {
    const gate = deferred<InstanceRelease[]>();
    const load = vi.fn(() => gate.promise);
    const cache = createInstanceVersionCache(load, { concurrency: 1 });
    const first = cache.get(target);
    const queuedTarget = { ...target, projectId: "queued" };
    const queued = cache.get(queuedTarget);
    await flushPromises();
    cache.publish(queuedTarget, [atm82]);
    gate.resolve([]);
    await first;
    expect((await queued).releases).toEqual([atm82]);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("starts a fresh ten-minute TTL at publication", async () => {
    const load = vi.fn(async () => [atm82]);
    const cache = createInstanceVersionCache(load);
    await cache.get(target);
    await vi.advanceTimersByTimeAsync(590000);
    cache.publish(target, [atm83, atm82]);
    const refreshed = await cache.get(target);
    await vi.advanceTimersByTimeAsync(599999);
    expect(await cache.get(target)).toBe(refreshed);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await cache.get(target)).not.toBe(refreshed);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("publishes a successful dialog snapshot to a mounted failed badge without retrying", async () => {
    api.execute.mockRejectedValue(new Error("offline"));
    const { pack, wrapper } = mountedPack();
    await flushPromises();
    expect(wrapper.text()).toBe("error");
    publishInstanceVersions(pack, [atm82]);
    await flushPromises();
    expect(wrapper.text()).toBe("current");
    expect(api.execute).toHaveBeenCalledTimes(1);
  });
});
