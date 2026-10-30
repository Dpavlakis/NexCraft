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
        ASelect: { name: "ASelect", props: ["children", "value", "loading", "options"], template: "<div/>" },
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
  api.updateStatus.mockResolvedValue(running("backup"));
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
      status().mockResolvedValue(ref(task));
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
      .mockResolvedValueOnce(running())
      .mockResolvedValueOnce(
        ref({ taskId: "job", status: 0, progress: { phase: "done", completed: true } })
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
