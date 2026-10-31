import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount, type VueWrapper } from "@vue/test-utils";
import { nextTick, reactive, ref, toRaw } from "vue";
import { message } from "ant-design-vue";

const api = vi.hoisted(() => ({
  create: vi.fn(),
  restore: vi.fn(),
  backupStatus: vi.fn(),
  list: vi.fn(),
  config: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  update: vi.fn(),
  reinstall: vi.fn(),
  updateStatus: vi.fn(),
  activeTask: vi.fn(),
  info: vi.fn(),
  versions: vi.fn(),
  publish: vi.fn(),
  serverVersions: vi.fn(),
  changelog: vi.fn(),
  report: vi.fn(),
  route: null as any
}));
vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
vi.mock("vue-router", () => ({ useRoute: () => api.route }));
vi.mock("@/hooks/useAppRouters", () => ({ useAppRouters: () => ({ toPage: vi.fn() }) }));
vi.mock("@/hooks/useInstanceVersions", () => ({
  INSTANCE_VERSIONS_TIMEOUT: 30000,
  publishInstanceVersions: api.publish
}));
vi.mock("@/hooks/useScreen", () => ({ useScreen: () => ({ isPhone: false }) }));
vi.mock("@/services/apis/fileManager", () => ({ fileList: () => ({ execute: vi.fn() }) }));
vi.mock("@/hooks/useFileManager", () => ({ getFileConfigAddr: vi.fn() }));
vi.mock("@/tools/validator", () => ({ reportErrorMsg: api.report }));
vi.mock("@/services/apis/backup", () => ({
  createBackup: () => ({ execute: api.create }),
  restoreBackup: () => ({ execute: api.restore }),
  backupTaskStatus: () => ({ execute: api.backupStatus }),
  backupList: () => ({ execute: api.list }),
  getBackupConfig: () => ({ execute: api.config }),
  setBackupConfig: () => ({ execute: api.save }),
  deleteBackup: () => ({ execute: api.remove }),
  backupDownloadAddress: () => ({ execute: api.download })
}));
vi.mock("@/services/apis/instance", () => ({ getInstanceInfo: () => ({ execute: api.info }) }));
vi.mock("@/services/apis/modpack", () => ({
  updateModpack: () => ({ execute: api.update }),
  reinstallServer: () => ({ execute: api.reinstall }),
  modpackTaskStatus: () => ({ execute: api.updateStatus }),
  activeModpackTask: () => ({ execute: api.activeTask }),
  modpackVersions: () => ({ execute: api.versions }),
  serverVersionsGet: () => ({ execute: api.serverVersions }),
  modpackChangelog: () => ({ execute: api.changelog })
}));
import Backups from "@/widgets/instance/Backups.vue";
import ModpackUpdate from "@/widgets/instance/ModpackUpdate.vue";
import OperationProgress from "@/components/OperationProgress.vue";

const pending = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const pack = {
  source: "modrinth",
  projectId: "pack",
  projectName: "Test pack",
  fileId: "old",
  versionName: "Old",
  mcVersion: "1.21.1",
  loader: "fabric",
  installedAt: 1
};
const card = (meta = { instanceId: "alpha", daemonId: "node-a" }) =>
  ({ id: "operation", title: "Backups", type: "test", meta }) as any;
const running = (phase = "archive") =>
  ref({
    taskId: "job",
    status: 1,
    progress: { phase, indeterminate: true, percentage: 0, entries: 14, processedBytes: 2048 }
  });
let wrappers: VueWrapper[] = [];
const settle = async () => {
  await flushPromises();
  await nextTick();
};
const create = (kind: "backup" | "update", value = card()) => {
  const wrapper = shallowMount(kind === "backup" ? Backups : ModpackUpdate, {
    props: { card: value },
    global: {
      renderStubDefaultSlot: true,
      stubs: {
        OperationProgress: false,
        ASelect: { name: "ASelect", props: ["children", "value", "loading", "options", "disabled"], template: "<div/>" },
        APopconfirm: { name: "APopconfirm", props: ["children"], template: "<div><slot/></div>" },
        CardPanel: { template: '<section><slot name="title"/><slot name="body"/></section>' },
        BetweenMenus: { template: '<nav><slot name="left"/><slot name="right"/></nav>' },
        AButton: {
          props: ["loading", "disabled"],
          template: '<button :disabled="loading || disabled"><slot/></button>'
        },
        AAlert: { props: ["message"], template: '<div role="alert">{{ message }}</div>' },
        AProgress: { props: ["percent"], template: "<div data-percent>{{ percent }}%</div>" }
      }
    }
  });
  wrappers.push(wrapper);
  return wrapper;
};
const backupButton = (wrapper: VueWrapper) =>
  wrapper.findAll("button").find((b) => b.text() === "TXT_CODE_backup_now")!;
const start = async (wrapper: VueWrapper, kind: "backup" | "update") => {
  if (kind === "backup") await backupButton(wrapper).trigger("click");
  else wrapper.findComponent({ name: "APopconfirm" }).vm.$emit("confirm");
  await settle();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  api.publish.mockImplementation((_pack, rows) => rows);
  api.route = reactive({ path: "/instances/modpackUpdate", query: {} });
  api.config.mockResolvedValue(
    ref({
      compress: true,
      maxBackups: 0,
      exclusions: [],
      shutdown: false,
      preCommand: "",
      postCommand: ""
    })
  );
  api.list.mockResolvedValue(ref([]));
  api.info.mockResolvedValue(ref({ config: { packInfo: pack } }));
  api.versions.mockResolvedValue(
    ref([
      {
        id: "new",
        name: "New",
        game_versions: ["1.21.1"],
        loaders: ["fabric"],
        date_published: "2026-10-30T00:00:00Z",
        version_type: "release"
      },
      {
        id: "old",
        name: "Old",
        game_versions: ["1.21.1"],
        loaders: ["fabric"],
        date_published: "2026-09-01T00:00:00Z",
        version_type: "release"
      }
    ])
  );
  api.changelog.mockResolvedValue(ref({ content: "Notes", format: "markdown" }));
  api.serverVersions.mockResolvedValue(
    ref([
      { id: "1.21.2", type: "release" },
      { id: "1.21.1", type: "release" }
    ])
  );
  for (const fn of [api.create, api.restore, api.update, api.reinstall])
    fn.mockResolvedValue(ref({ taskId: "job" }));
  api.backupStatus.mockResolvedValue(running());
  api.activeTask.mockReset().mockResolvedValue(ref(null));
  api.updateStatus.mockResolvedValue(ref({ ...running("backup").value, instanceUuid: "alpha" }));
  vi.spyOn(message, "success").mockImplementation(() => ({}) as any);
});
afterEach(() => {
  wrappers.forEach((w) => w.unmount());
  wrappers = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(["backup", "update"] as const)("native %s progress consumer", (kind) => {
  const status = () => (kind === "backup" ? api.backupStatus : api.updateStatus);
  const post = () => (kind === "backup" ? api.create : api.update);
  const reads = () => (kind === "backup" ? api.list : api.info);
  const successKey = () =>
    kind === "backup" ? "TXT_CODE_backup_created" : "TXT_CODE_modpack_update_done";

  it("sets busy before a delayed start POST and rejects double invocation", async () => {
    const response = pending();
    post().mockReturnValue(response.promise);
    const wrapper = create(kind);
    await settle();
    await start(wrapper, kind);
    expect(wrapper.findComponent(OperationProgress).exists()).toBe(true);
    await start(wrapper, kind);
    expect(post()).toHaveBeenCalledTimes(1);
    response.resolve(ref({ taskId: "job" }));
    await settle();
    expect(status()).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain(
      "TXT_CODE_operation_phase_" + (kind === "backup" ? "archive" : "backup")
    );
    expect(wrapper.find("[data-percent]").exists()).toBe(false);
  });

  it.each([null, { taskId: "job", status: -1 }])(
    "never reports success or refreshes info/list for %j",
    async (task) => {
      status().mockResolvedValue(ref(task && { ...task, instanceUuid: "alpha" }));
      const wrapper = create(kind);
      await settle();
      expect(reads()).toHaveBeenCalledTimes(1);
      await start(wrapper, kind);
      expect(message.success).not.toHaveBeenCalledWith(successKey());
      expect(wrapper.text()).toContain(
        task ? "TXT_CODE_operation_error_failed" : "TXT_CODE_operation_error_missing"
      );
      expect(reads()).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10000);
      expect(status()).toHaveBeenCalledTimes(1);
    }
  );

  it("refreshes only after confirmed task success", async () => {
    status()
      .mockResolvedValueOnce(ref({ ...running().value, instanceUuid: "alpha" }))
      .mockResolvedValueOnce(
        ref({ taskId: "job", instanceUuid: "alpha", status: 0, progress: { phase: "done", completed: true } })
      );
    const wrapper = create(kind);
    await settle();
    await start(wrapper, kind);
    expect(reads()).toHaveBeenCalledTimes(1);
    expect(message.success).not.toHaveBeenCalledWith(successKey());
    await vi.advanceTimersByTimeAsync(1500);
    await settle();
    expect(message.success).toHaveBeenCalledWith(successKey());
    expect(reads()).toHaveBeenCalledTimes(2);
    expect(wrapper.findComponent(OperationProgress).exists()).toBe(false);
  });

  it("discards late poll success when the card target is replaced", async () => {
    const response = pending();
    status().mockReturnValue(response.promise);
    const wrapper = create(kind);
    await settle();
    await start(wrapper, kind);
    await wrapper.setProps({ card: card({ instanceId: "beta", daemonId: "node-b" }) });
    await settle();
    response.resolve(ref({ taskId: "job", status: 0 }));
    await settle();
    expect(message.success).not.toHaveBeenCalledWith(successKey());
    expect(reads()).toHaveBeenCalledTimes(2);
    expect(reads()).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: { daemonId: "node-b", uuid: "beta" } })
    );
    expect(wrapper.findComponent(OperationProgress).exists()).toBe(false);
  });
});

it("preserves the Bedrock world-preserving reinstall payload", async () => {
  api.info.mockResolvedValue(
    ref({ config: { packInfo: { ...pack, source: "bedrock", mcVersion: "1.21.1" } } })
  );
  const wrapper = create("update");
  await settle();
  await start(wrapper, "update");
  expect(api.reinstall).toHaveBeenCalledExactlyOnceWith({
    params: { daemonId: "node-a", uuid: "alpha" },
    data: { mcVersion: "1.21.2", loader: "bedrock", acceptEula: true, resetMode: "preserve_world" },
    forceRequest: true
  });
  expect(api.update).not.toHaveBeenCalled();
});

it("restores only from the existing confirmed list event and never succeeds on failure", async () => {
  api.backupStatus.mockResolvedValue(ref({ taskId: "job", status: -1 }));
  const wrapper = create("backup");
  await settle();
  expect(api.restore).not.toHaveBeenCalled();
  wrapper.findComponent({ name: "BackupList" }).vm.$emit("restore", { name: "world.zip" });
  await settle();
  expect(api.restore).toHaveBeenCalledExactlyOnceWith({
    params: { daemonId: "node-a", uuid: "alpha" },
    data: { file_name: "world.zip" },
    forceRequest: true
  });
  expect(message.success).not.toHaveBeenCalledWith("TXT_CODE_backup_restore_done");
  expect(api.list).toHaveBeenCalledTimes(1);
});


describe("version snapshot publication from the update card", () => {
  const old = { id: "old", name: "Old", game_versions: ["1.21.1"], loaders: ["fabric"],
    date_published: "2026-09-01T00:00:00Z", version_type: "release" };
  const latest = { id: "new", name: "New", game_versions: ["1.21.1"], loaders: ["fabric"],
    date_published: "2026-10-30T00:00:00Z", version_type: "release" };

  it("publishes the captured project and fetched rows once, using returned canonical ordering", async () => {
    const capturedPack = { ...pack, projectId: "captured-project" };
    const rows = [old, latest];
    api.info.mockResolvedValue(ref({ config: { packInfo: capturedPack } }));
    api.versions.mockResolvedValue(ref(rows));
    api.publish.mockReturnValueOnce([latest, old]);
    const wrapper = create("update");
    await settle();
    expect(api.publish).toHaveBeenCalledTimes(1);
    expect(toRaw(api.publish.mock.calls[0][0])).toBe(capturedPack);
    expect(toRaw(api.publish.mock.calls[0][1])).toBe(rows);
    const picker = wrapper.findComponent({ name: "ASelect" });
    expect(picker.props("options").map((item: { value: string }) => item.value)).toEqual(["new", "old"]);
    expect(picker.props("value")).toBe("new");
    expect(api.changelog).toHaveBeenCalledWith(expect.objectContaining({
      params: { source: "modrinth", projectId: "captured-project", versionId: "new" }
    }));
    expect(api.versions).toHaveBeenCalledTimes(1);
  });

  it.each(["target replacement", "unmount"])("does not publish a late version response after %s", async (change) => {
    const late = pending();
    api.versions.mockReturnValueOnce(late.promise);
    const wrapper = create("update");
    await settle();
    expect(api.publish).not.toHaveBeenCalled();
    const oldSignal = api.versions.mock.calls[0][0].signal;
    const nextPack = { ...pack, projectId: "next-project" };
    const nextRows = [latest, old];
    if (change === "target replacement") {
      api.info.mockResolvedValue(ref({ config: { packInfo: nextPack } }));
      api.versions.mockResolvedValue(ref(nextRows));
      await wrapper.setProps({ card: card({ instanceId: "beta", daemonId: "node-b" }) });
      await settle();
      expect(api.publish).toHaveBeenCalledTimes(1);
      expect(toRaw(api.publish.mock.calls[0][0])).toBe(nextPack);
      expect(toRaw(api.publish.mock.calls[0][1])).toBe(nextRows);
    } else {
      wrappers.splice(wrappers.indexOf(wrapper), 1);
      wrapper.unmount();
    }
    expect(oldSignal.aborted).toBe(true);
    late.resolve(ref([old]));
    await settle();
    expect(api.publish).toHaveBeenCalledTimes(change === "target replacement" ? 1 : 0);
  });
});


describe("update progress reconnect from the daemon", () => {
  const active = (overrides = {}) => ({
    ...running("download").value,
    instanceUuid: "alpha",
    progress: { phase: "download", indeterminate: false, percentage: 42 },
    ...overrides
  });
  const updateButton = (wrapper: VueWrapper) =>
    wrapper.findAll("button").find((b) => b.text() === "TXT_CODE_modpack_update_btn")!;
  const refreshButton = (wrapper: VueWrapper) =>
    wrapper.findAll("button").find((b) => b.text() === "TXT_CODE_b76d94e0")!;
  const expectLocked = (wrapper: VueWrapper, locked = true) => {
    expect(updateButton(wrapper).attributes("disabled") !== undefined).toBe(locked);
    expect(wrapper.findComponent({ name: "ASelect" }).props("disabled")).toBe(locked);
  };
  const unmount = (wrapper: VueWrapper) => {
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    wrapper.unmount();
  };

  it("starts once, unmounts, and restores the same job on reopen without another POST or started toast", async () => {
    const original = create("update");
    await settle();
    await start(original, "update");
    expect(api.update).toHaveBeenCalledTimes(1);
    const oldSignal = api.updateStatus.mock.calls[0][0].signal;
    unmount(original);
    expect(oldSignal.aborted).toBe(true);
    api.activeTask.mockResolvedValue(ref(active()));
    api.updateStatus.mockResolvedValue(ref(active()));
    const reopened = create("update");
    await settle();
    expect(reopened.get("[data-percent]").text()).toBe("42%");
    expect(reopened.text()).toContain("TXT_CODE_operation_phase_download");
    expectLocked(reopened);
    await start(reopened, "update");
    await vi.advanceTimersByTimeAsync(1500);
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.updateStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      params: { daemonId: "node-a", task_id: "job" }, forceRequest: true
    }));
    expect(vi.mocked(message.success).mock.calls.filter(([key]) => key === "TXT_CODE_modpack_update_started")).toHaveLength(1);
    expect(api.reinstall).not.toHaveBeenCalled();
  });

  it("discovers on a cold mount before slow instance, versions or changelog requests finish", async () => {
    const info = pending();
    api.info.mockReturnValueOnce(info.promise);
    api.activeTask.mockResolvedValue(ref(active()));
    const wrapper = create("update");
    expect(api.activeTask).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      params: { daemonId: "node-a", uuid: "alpha" }, forceRequest: true,
      timeout: 30000, signal: expect.any(AbortSignal)
    }));
    await settle();
    expect(wrapper.get("[data-percent]").text()).toBe("42%");
    expect(api.versions).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
    info.resolve(ref({ config: { packInfo: pack } }));
    await settle();
    expectLocked(wrapper);
  });

  it("locks during discovery, then explicit null permits a normal update", async () => {
    const response = pending();
    api.activeTask.mockReturnValueOnce(response.promise);
    const wrapper = create("update");
    await settle();
    expectLocked(wrapper);
    await start(wrapper, "update");
    expect(api.update).not.toHaveBeenCalled();
    response.resolve(ref(null));
    await settle();
    expectLocked(wrapper, false);
    expect(wrapper.findComponent(OperationProgress).exists()).toBe(false);
    await start(wrapper, "update");
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it.each(["versions", "changelog"] as const)("restores without waiting for slow %s", async (source) => {
    api[source].mockReturnValueOnce(pending().promise);
    api.activeTask.mockResolvedValue(ref(active()));
    const wrapper = create("update");
    await settle();
    expect(wrapper.get("[data-percent]").text()).toBe("42%");
    expectLocked(wrapper);
  });

  it("refreshes the installed pack exactly once on confirmed resumed completion", async () => {
    api.activeTask.mockResolvedValue(ref(active()));
    api.updateStatus.mockResolvedValue(ref(active({ status: 0, progress: { completed: true } })));
    const wrapper = create("update");
    await settle();
    expect(api.info).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    await settle();
    expect(api.info).toHaveBeenCalledTimes(2);
    expect(message.success).toHaveBeenCalledExactlyOnceWith("TXT_CODE_modpack_update_done");
    expectLocked(wrapper, false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.updateStatus).toHaveBeenCalledTimes(1);
    expect(api.info).toHaveBeenCalledTimes(2);
    expect(api.update).not.toHaveBeenCalled();
  });

  it("uses the same discovery and status endpoints for an existing Bedrock preserve-world installer", async () => {
    api.info.mockResolvedValue(ref({ config: { packInfo: { ...pack, source: "bedrock" } } }));
    api.activeTask.mockResolvedValue(ref(active({ taskId: "installer-job" })));
    api.updateStatus.mockResolvedValue(ref(active({ taskId: "installer-job", progress: undefined,
      phase: "download", downloadProgress: { percentage: 63 } })));
    const wrapper = create("update");
    await settle();
    expectLocked(wrapper);
    await vi.advanceTimersByTimeAsync(1500);
    expect(wrapper.get("[data-percent]").text()).toBe("63%");
    expect(api.updateStatus).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      params: { daemonId: "node-a", task_id: "installer-job" }
    }));
    expect(api.activeTask).toHaveBeenCalledTimes(1);
    expect(api.reinstall).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { taskId: "job", status: 1 },
    { taskId: "job", status: 1, instanceUuid: "beta" },
    { taskId: "job", status: -1, instanceUuid: "alpha" },
    { taskId: "job", status: 0, instanceUuid: "alpha" }])(
    "fails closed for invalid, mismatched or terminal discovery %j until Refresh confirms idle", async (result) => {
      api.activeTask.mockResolvedValueOnce(ref(result));
      const wrapper = create("update");
      await settle();
      expectLocked(wrapper);
      expect(wrapper.get('[role="alert"]').text()).toBe("TXT_CODE_operation_error_unavailable");
      expect(message.success).not.toHaveBeenCalled();
      await start(wrapper, "update");
      expect(api.update).not.toHaveBeenCalled();
      expect(api.updateStatus).not.toHaveBeenCalled();
      api.activeTask.mockResolvedValue(ref(null));
      await refreshButton(wrapper).trigger("click");
      await settle();
      expectLocked(wrapper, false);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    }
  );

  it("shows a localized discovery transport error and retries only on Refresh", async () => {
    api.activeTask.mockRejectedValueOnce(new Error("offline"));
    const wrapper = create("update");
    await settle();
    expectLocked(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toBe("TXT_CODE_operation_error_unavailable");
    await vi.advanceTimersByTimeAsync(30000);
    expect(api.activeTask).toHaveBeenCalledTimes(1);
    api.activeTask.mockResolvedValue(ref(active()));
    await refreshButton(wrapper).trigger("click");
    await settle();
    expect(wrapper.get("[data-percent]").text()).toBe("42%");
    expectLocked(wrapper);
    expect(api.update).not.toHaveBeenCalled();
  });

  it.each(["target", "unmount"])("aborts and ignores late discovery after %s", async (change) => {
    const response = pending();
    api.activeTask.mockReturnValueOnce(response.promise);
    const wrapper = create("update");
    await settle();
    const signal = api.activeTask.mock.calls[0][0].signal;
    if (change === "target") {
      await wrapper.setProps({ card: card({ instanceId: "beta", daemonId: "node-b" }) });
      await settle();
      expect(api.activeTask).toHaveBeenLastCalledWith(expect.objectContaining({
        params: { daemonId: "node-b", uuid: "beta" }
      }));
    } else unmount(wrapper);
    expect(signal.aborted).toBe(true);
    response.resolve(ref(active()));
    await settle();
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.updateStatus).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
    if (change === "target") expectLocked(wrapper, false);
  });

  it("ignores late discovery even after the target changes away and back", async () => {
    const response = pending();
    api.activeTask.mockReturnValueOnce(response.promise);
    const wrapper = create("update");
    await settle();
    await wrapper.setProps({ card: card({ instanceId: "beta", daemonId: "node-a" }) });
    await settle();
    await wrapper.setProps({ card: card() });
    await settle();
    response.resolve(ref(active()));
    await settle();
    expectLocked(wrapper, false);
    expect(wrapper.findComponent(OperationProgress).exists()).toBe(false);
    expect(api.activeTask).toHaveBeenCalledTimes(3);
  });

  it.each(["target", "unmount"])("ignores a late resumed completion after %s", async (change) => {
    const response = pending();
    api.activeTask.mockResolvedValueOnce(ref(active()));
    api.updateStatus.mockReturnValueOnce(response.promise);
    const wrapper = create("update");
    await settle();
    await vi.advanceTimersByTimeAsync(1500);
    const signal = api.updateStatus.mock.calls[0][0].signal;
    if (change === "target") {
      await wrapper.setProps({ card: card({ instanceId: "beta", daemonId: "node-b" }) });
      await settle();
    } else unmount(wrapper);
    expect(signal.aborted).toBe(true);
    response.resolve(ref(active({ status: 0, progress: { completed: true } })));
    await settle();
    await vi.advanceTimersByTimeAsync(15000);
    expect(message.success).not.toHaveBeenCalled();
    expect(api.info).toHaveBeenCalledTimes(change === "target" ? 2 : 1);
    expect(api.updateStatus).toHaveBeenCalledTimes(1);
  });

  it.each([null, { taskId: "other", status: 0, instanceUuid: "alpha" },
    { taskId: "job", status: 0 }, { taskId: "job", status: 0, instanceUuid: "beta" },
    { taskId: "job", status: -1, instanceUuid: "alpha" }])(
    "never refreshes or reports success for a missing, mismatched or failed resumed poll %j", async (result) => {
      api.activeTask.mockResolvedValue(ref(active()));
      api.updateStatus.mockResolvedValue(ref(result));
      const wrapper = create("update");
      await settle();
      await vi.advanceTimersByTimeAsync(1500);
      await settle();
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expectLocked(wrapper);
      expect(message.success).not.toHaveBeenCalled();
      expect(api.info).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10000);
      expect(api.updateStatus).toHaveBeenCalledTimes(1);
    }
  );

  it("clears a resumed poll failure only after Refresh confirms null idle, without another write", async () => {
    api.activeTask.mockResolvedValueOnce(ref(active()));
    api.updateStatus.mockRejectedValueOnce(new Error("offline"));
    const wrapper = create("update");
    await settle();
    await vi.advanceTimersByTimeAsync(1500);
    await settle();
    expectLocked(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toBe("TXT_CODE_operation_error_unavailable");
    api.activeTask.mockResolvedValue(ref(null));
    await refreshButton(wrapper).trigger("click");
    await settle();
    expectLocked(wrapper, false);
    expect(wrapper.findComponent(OperationProgress).exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.updateStatus).toHaveBeenCalledTimes(1);
    expect(api.update).not.toHaveBeenCalled();
    expect(api.reinstall).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
  });

  it("keeps a pending update POST locked when Refresh discovers no task yet", async () => {
    const post = pending();
    api.update.mockReturnValueOnce(post.promise);
    const wrapper = create("update");
    await settle();
    await start(wrapper, "update");
    await refreshButton(wrapper).trigger("click");
    await settle();
    expect(api.activeTask).toHaveBeenCalledTimes(2);
    expectLocked(wrapper);
    await start(wrapper, "update");
    expect(api.update).toHaveBeenCalledTimes(1);
    post.resolve(ref({ taskId: "job" }));
    await settle();
    expect(api.updateStatus).toHaveBeenCalledTimes(1);
    expectLocked(wrapper);
  });

  it("coalesces Refresh discovery and replaces the old local poll without writes", async () => {
    api.activeTask.mockResolvedValueOnce(ref(active()));
    api.updateStatus.mockResolvedValue(ref(active()));
    const wrapper = create("update");
    await settle();
    const discovery = pending();
    api.activeTask.mockReturnValueOnce(discovery.promise);
    const refresh = refreshButton(wrapper);
    await refresh.trigger("click");
    // Emit directly as well: duplicate handlers must still be harmless.
    refresh.element.dispatchEvent(new Event("click", { bubbles: true }));
    await settle();
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.activeTask).toHaveBeenCalledTimes(2);
    expect(api.updateStatus).not.toHaveBeenCalled();
    expectLocked(wrapper);
    discovery.resolve(ref(active({ progress: { phase: "apply", indeterminate: true } })));
    await settle();
    expect(wrapper.text()).toContain("TXT_CODE_operation_phase_apply");
    await vi.advanceTimersByTimeAsync(1500);
    expect(api.updateStatus).toHaveBeenCalledTimes(1);
    expect(api.update).not.toHaveBeenCalled();
    expect(api.reinstall).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
  });
});
