import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, shallowMount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { message, Table } from "ant-design-vue";
import { useLocalMods } from "@/widgets/instance/mod-manager/useLocalMods";
import LocalModTable from "@/widgets/instance/mod-manager/LocalModTable.vue";
import ModManager from "@/widgets/instance/ModManager.vue";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  batch: vi.fn(),
  toggle: vi.fn(),
  remove: vi.fn(),
  remoteSearch: vi.fn(),
  queue: vi.fn(),
  uploadRefresh: undefined as any,
  queueRefresh: undefined as any
}));
vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/services/apis/modManager", () => ({
  modListApi: () => ({ execute: api.list }),
  getModBatchInfoApi: () => ({ execute: api.batch }),
  toggleModApi: () => ({ execute: api.toggle }),
  deleteModApi: () => ({ execute: api.remove })
}));
vi.mock("@/hooks/useScreen", () => ({ useScreen: () => ({ isPhone: ref(false) }) }));
vi.mock("@/hooks/useAppRouters", () => ({ useAppRouters: () => ({ toPage: vi.fn() }) }));
vi.mock("@/hooks/useCardTools", () => ({
  useLayoutCardTools: () => ({
    getMetaOrRouteValue: (key: string) => (key === "instanceId" ? "instance" : "daemon")
  })
}));
vi.mock("@/hooks/useInstance", () => ({
  useInstanceInfo: () => ({
    instanceInfo: ref({ config: { cwd: "/server" }, status: 0 }),
    isRunning: ref(false)
  })
}));
vi.mock("@/widgets/instance/mod-manager/useDeferredTasks", () => ({
  useDeferredTasks: (_i: string, _d: string, refresh: any) => {
    api.queueRefresh = refresh;
    return {
      deferredTasks: ref([]),
      autoExecute: ref(false),
      isExecuting: ref(false),
      addDeferredTask: api.queue
    };
  }
}));
vi.mock("@/widgets/instance/mod-manager/useModSearch", () => ({
  useModSearch: () => ({
    searchFilters: reactive({ query: "remote query", source: "all" }),
    searchLoading: ref(false),
    searched: ref(false),
    searchResults: ref([]),
    searchTotal: ref(0),
    searchPage: ref(1),
    searchLimit: ref(20),
    mcVersions: ref([]),
    loaderOptions: ref([]),
    loadMcVersions: vi.fn(),
    onSearch: api.remoteSearch,
    resetSearch: vi.fn(),
    showVersions: vi.fn(),
    onDownload: vi.fn(),
    showVersionModal: ref(false),
    selectedMod: ref(null),
    versions: ref([]),
    versionsLoading: ref(false),
    formatDate: vi.fn()
  })
}));
vi.mock("@/widgets/instance/mod-manager/useModUpload", () => ({
  useModUpload: (_i: string, _d: string, _tab: any, refresh: any) => {
    api.uploadRefresh = refresh;
    return { opacity: ref(0), fileInput: ref(null), onFileChange: vi.fn() };
  }
}));
vi.mock("@/widgets/instance/mod-manager/useModConfig", () => ({
  useModConfig: () => ({
    showConfigModal: ref(false),
    currentMod: ref(null),
    configFiles: ref([]),
    configLoading: ref(false)
  })
}));
vi.mock("@/widgets/instance/dialogs/FileEditor.vue", () => ({ default: { render: () => null } }));
vi.mock("@/widgets/instance/mod-manager/ModConfigModal.vue", () => ({
  default: { render: () => null }
}));
vi.mock("@/widgets/instance/mod-manager/ModFloatingTools.vue", () => ({
  default: { render: () => null }
}));
vi.mock("@/widgets/instance/mod-manager/ModVersionModal.vue", () => ({
  default: { render: () => null }
}));
vi.mock("@/widgets/instance/mod-manager/SearchModTable.vue", () => ({
  default: { render: () => null }
}));

const wrappers: VueWrapper[] = [];
const installed = Array.from({ length: 263 }, (_, i) => ({
  name: i === 235 ? "Installed Toast" : `Installed ${i}`,
  file: i === 235 ? "mods/Toast-1.0.jar.disabled" : `mods/mod-${i}.jar`,
  folder: "mods",
  type: "mod",
  enabled: i !== 235,
  hash: `hash-${i}`
}));
const plugins = Array.from({ length: 267 }, (_, i) => ({
  name: `Plugin ${i}`,
  file: `plugins/plugin-${i}.jar`,
  folder: "plugins",
  type: "plugin",
  enabled: true
}));
const fixture = [
  ...installed,
  ...plugins,
  {
    name: "",
    file: "plugins/Toast[+].jar.disabled",
    folder: "plugins",
    type: "plugin",
    enabled: false
  }
];
// Fake the agreed server contract, so the real hook must request the matching server page.
const serveList = ({ params }: any) => {
  const query = (params.query || "").trim().toLowerCase();
  const matches = fixture.filter(
    (row) =>
      (!params.folder || row.folder === params.folder) &&
      (row.name.toLowerCase().includes(query) || row.file.toLowerCase().includes(query))
  );
  const pageSize = Math.min(params.pageSize || 50, 250);
  const page = Math.max(1, Math.min(params.page || 1, Math.ceil(matches.length / pageSize)));
  return ref({
    mods: matches.slice((page - 1) * pageSize, page * pageSize).map((row) => ({ ...row })),
    folders: ["mods", "plugins"],
    total: matches.length,
    page,
    pageSize,
    downloadTasks: []
  });
};
const pending = () => {
  let resolve!: (value: any) => void;
  let reject!: (value: any) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const response = (name: string, extras: Record<string, any> = {}) =>
  ref({
    mods: [{ name, file: `${name}.jar`, folder: "mods", hash: "shared" }],
    folders: ["mods", "plugins"],
    total: 1,
    page: 1,
    pageSize: 50,
    downloadTasks: [],
    ...extras
  });
const settle = async () => {
  await flushPromises();
  await nextTick();
};
const context = (confirm = vi.fn((_type, _name, _data, run) => run())) => {
  let flow!: ReturnType<typeof useLocalMods>;
  const queue = vi.fn();
  const wrapper = mount(
    defineComponent({
      setup() {
        flow = useLocalMods("instance", "daemon", confirm, queue);
        return () => h("div");
      }
    })
  );
  wrappers.push(wrapper);
  return { flow, confirm, queue, wrapper };
};
const search = async (flow: ReturnType<typeof useLocalMods>, query: string) => {
  flow.headerSearchQuery.value = query;
  await vi.advanceTimersByTimeAsync(600);
  await settle();
};
beforeEach(() => {
  vi.useFakeTimers();
  Object.values(api).forEach((fn) => {
    if (typeof fn?.mockReset === "function") fn.mockReset();
  });
  api.list.mockImplementation(serveList);
  api.batch.mockImplementation(async ({ data }: any) =>
    ref(Object.fromEntries(data.hashes.map((hash: string) => [hash, { project: { title: hash } }])))
  );
  api.toggle.mockResolvedValue(ref(true));
  api.remove.mockResolvedValue(ref(true));
  vi.spyOn(message, "success").mockImplementation(() => (() => {}) as any);
  vi.spyOn(message, "error").mockImplementation(() => (() => {}) as any);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {}
    }))
  );
  const computedStyle = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => computedStyle(element));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("installed list hook", () => {
  it("finds a last-page Toast from page one without downloading other pages, with a 600ms debounce", async () => {
    const { flow } = context();
    await flow.loadMods("mods");
    expect(flow.mods.value).toHaveLength(50);
    expect(flow.mods.value.some((row) => row.name.includes("Toast"))).toBe(false);
    expect(flow.tablePagination.total).toBe(263);
    flow.headerSearchQuery.value = "T";
    await vi.advanceTimersByTimeAsync(300);
    flow.headerSearchQuery.value = "  tOaSt  ";
    expect(flow.mods.value).toEqual([]);
    await vi.advanceTimersByTimeAsync(599);
    expect(api.list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.list.mock.lastCall![0].params).toMatchObject({
      query: "tOaSt",
      page: 1,
      pageSize: 50,
      folder: "mods"
    });
    expect(flow.mods.value.map((row) => row.file)).toEqual(["mods/Toast-1.0.jar.disabled"]);
    expect(flow.tablePagination.total).toBe(1);
    expect(api.batch.mock.calls.map(([arg]) => arg.data.hashes.length)).toEqual([50, 1]);
  });

  it("resets query/clear/size changes to page one and retains query through paging, folder and refresh", async () => {
    const { flow } = context();
    await flow.loadMods("mods");
    flow.handleTableChange({ current: 5, pageSize: 50 });
    await settle();
    await search(flow, "installed");
    expect(flow.tablePagination.current).toBe(1);
    flow.handleTableChange({ current: 2, pageSize: 50 });
    await settle();
    expect(api.list.mock.lastCall![0].params).toMatchObject({ query: "installed", page: 2 });
    flow.handleTableChange({ current: 2, pageSize: 100 });
    await settle();
    expect(flow.tablePagination.current).toBe(1);
    expect(flow.mods.value).toHaveLength(100);
    expect(flow.tablePagination.pageSizeOptions).toEqual(["10", "20", "50", "100", "250"]);
    flow.handleTableChange({ current: 1, pageSize: 250 });
    await settle();
    expect(flow.mods.value).toHaveLength(250);
    expect(api.batch.mock.lastCall![0].data.hashes).toHaveLength(100); // The preceding pages, including page five, are cached.
    await flow.loadMods(flow.currentFolder.value);
    expect(api.list.mock.lastCall![0].params).toMatchObject({ query: "installed", pageSize: 250 });
    await flow.loadMods("plugins");
    expect(api.list.mock.lastCall![0].params).toMatchObject({
      query: "installed",
      folder: "plugins",
      page: 1
    });
    expect(flow.mods.value).toEqual([]);
    expect(flow.totalMods.value).toBe(0);
    expect(flow.folders.value).toEqual(["mods", "plugins"]);
    await search(flow, "");
    expect(flow.tablePagination.current).toBe(1);
    expect(flow.totalMods.value).toBe(268);
    expect(flow.mods.value).toHaveLength(250);
  });

  it("matches literal filenames, including disabled files and fallback names; empty results clear the old page", async () => {
    const { flow } = context();
    await flow.loadMods("plugins");
    await search(flow, "  TOAST[+]  ");
    expect(flow.mods.value.map((row) => row.file)).toEqual(["plugins/Toast[+].jar.disabled"]);
    expect(flow.totalMods.value).toBe(1);
    await search(flow, "does-not-exist");
    expect(flow.mods.value).toEqual([]);
    expect(flow.totalMods.value).toBe(0);
    expect(flow.tablePagination).toMatchObject({ current: 1, total: 0 });
    expect(flow.folders.value).toEqual(["mods", "plugins"]);
    await search(flow, "");
    expect(flow.mods.value).toHaveLength(50);
    expect(flow.tablePagination).toMatchObject({ current: 1, total: 268, pageSize: 50 });
  });

  it("accepts the server's clamped page and pageSize after refresh or mutation", async () => {
    const { flow } = context();
    await flow.loadMods("mods");
    api.list.mockResolvedValueOnce(response("remaining", { page: 1, pageSize: 100, total: 1 }));
    flow.handleTableChange({ current: 5, pageSize: 50 });
    await settle();
    expect(api.list.mock.lastCall![0].params.page).toBe(5);
    expect(flow.tablePagination).toMatchObject({ current: 1, pageSize: 100, total: 1 });
  });

  it.each(["query", "page", "folder"])(
    "rejects a late %s response and its pagination/folder/status metadata",
    async (change) => {
      const { flow } = context();
      await flow.loadMods("mods");
      const slow = pending();
      api.list.mockReturnValueOnce(slow.promise);
      const first = flow.loadMods("mods");
      const signal = api.list.mock.lastCall![0].signal;
      if (change === "query") await search(flow, "Toast");
      if (change === "page") {
        flow.handleTableChange({ current: 2, pageSize: 50 });
        await settle();
      }
      if (change === "folder") await flow.loadMods("plugins");
      const accepted = {
        files: flow.mods.value.map((row) => row.file),
        page: flow.tablePagination.current,
        total: flow.totalMods.value
      };
      expect(signal.aborted).toBe(true);
      slow.resolve(
        response("obsolete", {
          folders: ["obsolete"],
          page: 99,
          pageSize: 10,
          total: 999,
          downloadTasks: [{ name: "old" }]
        })
      );
      await first;
      expect(flow.mods.value.map((row) => row.file)).toEqual(accepted.files);
      expect(flow.tablePagination).toMatchObject({ current: accepted.page, total: accepted.total });
      expect(flow.folders.value).toEqual(["mods", "plugins"]);
      expect(flow.fileStatus.value.downloadTasks).toEqual([]);
      expect(flow.loading.value).toBe(false);
    }
  );

  it("fences before the debounce expires and suppresses stale failures", async () => {
    const { flow } = context();
    const slow = pending();
    api.list.mockReturnValueOnce(slow.promise);
    const first = flow.loadMods("mods");
    flow.headerSearchQuery.value = "Toast";
    slow.reject(new Error("old request failed"));
    await first;
    expect(flow.mods.value).toEqual([]);
    expect(flow.loading.value).toBe(true);
    expect(message.error).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(flow.mods.value).toHaveLength(1);
  });

  it.each(["query", "page", "folder"])(
    "fences slow hash enrichment across a %s change without poisoning the cache",
    async (change) => {
      const { flow } = context();
      const slow = pending();
      api.batch.mockReturnValueOnce(slow.promise);
      api.list.mockResolvedValueOnce(response("old"));
      const first = flow.loadMods("mods");
      await settle();
      const signal = api.batch.mock.lastCall![0].signal;
      api.batch.mockResolvedValueOnce(ref({ shared: { project: { title: "current" } } }));
      api.list.mockResolvedValueOnce(response("new", { folders: ["mods", "plugins"] }));
      if (change === "query") await search(flow, "new");
      if (change === "page") {
        flow.handleTableChange({ current: 2, pageSize: 50 });
        await settle();
      }
      if (change === "folder") await flow.loadMods("plugins");
      slow.resolve(ref({ shared: { project: { title: "obsolete" } } }));
      await first;
      expect(signal.aborted).toBe(true);
      expect(flow.mods.value[0].name).toBe("new");
      expect(flow.mods.value[0].extraInfo.project.title).toBe("current");
      api.list.mockResolvedValueOnce(response("again"));
      await flow.loadMods(flow.currentFolder.value);
      expect(flow.mods.value[0].extraInfo.project.title).toBe("current");
      expect(flow.loadingExtra.value).toBe(false);
    }
  );

  it("keeps enrichment to the current 250 rows, reuses hashes and passes all hashes to the batch API", async () => {
    const { flow } = context();
    await flow.loadMods("mods");
    flow.handleTableChange({ current: 1, pageSize: 250 });
    await settle();
    expect(api.batch.mock.lastCall![0].data.hashes).toHaveLength(200);
    expect(flow.mods.value).toHaveLength(250);
    expect(flow.mods.value.every((row) => row.extraInfo)).toBe(true);
    const batches = api.batch.mock.calls.length;
    await flow.loadMods("mods");
    expect(api.batch).toHaveBeenCalledTimes(batches);
    expect(api.list).toHaveBeenCalledTimes(3);
  });

  it.each(["list", "metadata", "debounce"])(
    "cancels %s work on unmount and never republishes or polls",
    async (kind) => {
      const { flow, wrapper } = context();
      const slow = pending();
      if (kind === "list") api.list.mockReturnValueOnce(slow.promise);
      if (kind === "metadata") {
        api.list.mockResolvedValueOnce(response("old"));
        api.batch.mockReturnValueOnce(slow.promise);
      }
      const first = kind === "debounce" ? Promise.resolve() : flow.loadMods("mods");
      await settle();
      if (kind === "debounce") flow.headerSearchQuery.value = "Toast";
      const signal =
        kind === "metadata"
          ? api.batch.mock.lastCall![0].signal
          : api.list.mock.lastCall?.[0].signal;
      wrapper.unmount();
      const rows = flow.mods.value;
      const calls = api.list.mock.calls.length;
      slow.resolve(
        kind === "metadata"
          ? ref({ shared: { stale: true } })
          : response("late", { downloadTasks: [{}] })
      );
      await first;
      await vi.advanceTimersByTimeAsync(10000);
      expect(flow.mods.value).toBe(rows);
      expect(flow.loading.value).toBe(false);
      expect(flow.loadingExtra.value).toBe(false);
      expect(api.list).toHaveBeenCalledTimes(calls);
      if (signal) expect(signal.aborted).toBe(true);
      expect(message.error).not.toHaveBeenCalled();
    }
  );

  it("preserves exact file action data and confirmation/deferred gating; successful actions refresh the current query", async () => {
    const confirm = vi.fn();
    const { flow, queue } = context(confirm);
    await flow.loadMods("mods");
    await search(flow, "Toast");
    const record = flow.mods.value[0];
    const exactFile = record.file;
    await flow.onToggle(record);
    await flow.onDelete(record);
    const data = { uuid: "instance", daemonId: "daemon", fileName: exactFile };
    expect(confirm.mock.calls[0].slice(0, 3)).toEqual(["toggle", exactFile, data]);
    expect(confirm.mock.calls[1].slice(0, 3)).toEqual(["delete", exactFile, data]);
    expect(api.toggle).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
    await confirm.mock.calls[0][3]();
    expect(api.toggle).toHaveBeenCalledExactlyOnceWith({ data });
    expect(api.list.mock.lastCall![0].params).toMatchObject({ query: "Toast", folder: "mods" });
    await confirm.mock.calls[1][3]();
    expect(api.remove).toHaveBeenCalledExactlyOnceWith({ data });
    expect(api.list.mock.lastCall![0].params).toMatchObject({ query: "Toast", folder: "mods" });
  });

  it("polls with the query, rejects an old-folder poll and stops on completed downloads", async () => {
    const { flow } = context();
    await search(flow, "Toast");
    api.list.mockResolvedValueOnce(response("Toast", { downloadTasks: [{}] }));
    await flow.loadMods("mods");
    const slow = pending();
    api.list.mockReturnValueOnce(slow.promise);
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.list.mock.lastCall![0].params).toMatchObject({ query: "Toast", folder: "mods" });
    const signal = api.list.mock.lastCall![0].signal;
    await flow.loadMods("plugins");
    slow.resolve(response("old", { folders: ["old"], downloadTasks: [{}] }));
    await settle();
    expect(signal.aborted).toBe(true);
    expect(flow.mods.value[0].file).toBe("plugins/Toast[+].jar.disabled");
    const count = api.list.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.list).toHaveBeenCalledTimes(count);
  });

  it("supports a cold 250-row metadata batch and keeps download polling alive on the Download tab", async () => {
    const { flow } = context();
    flow.tablePagination.pageSize = 250;
    api.list.mockImplementationOnce((config) => {
      const result = serveList(config);
      (result.value.downloadTasks as any[]) = [{}];
      return result;
    });
    await flow.loadMods("mods");
    expect(flow.mods.value).toHaveLength(250);
    expect(api.batch.mock.lastCall![0].data.hashes).toHaveLength(250);
    flow.setListActive(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.list.mock.lastCall![0].params).toMatchObject({
      folder: "mods",
      pageSize: 250,
      query: ""
    });
    expect(flow.fileStatus.value.downloadTasks).toEqual([]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.list).toHaveBeenCalledTimes(2);
  });
  it("does not overlap slow polls and uses the final poll as the refreshed list", async () => {
    const { flow } = context();
    api.list.mockResolvedValueOnce(response("downloading", { downloadTasks: [{}] }));
    await flow.loadMods("mods");
    const slow = pending();
    api.list.mockReturnValueOnce(slow.promise);
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.list).toHaveBeenCalledTimes(2);
    slow.resolve(response("complete"));
    await settle();
    expect(flow.mods.value[0].name).toBe("complete");
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.list).toHaveBeenCalledTimes(2);
  });
});

const pass = { template: '<div><slot/><slot name="tab"/></div>' };
const createWidget = async () => {
  const wrapper = shallowMount(ModManager, {
    props: { card: { id: "mods", type: "test", meta: {} } as any },
    global: {
      renderStubDefaultSlot: true,
      stubs: {
        ...Object.fromEntries(
          [
            "ATypographyTitle",
            "ASpace",
            "ACol",
            "ARow",
            "AAlert",
            "AForm",
            "AFormItem",
            "ASelect",
            "ASelectOption"
          ].map((name) => [name, true])
        ),
        BetweenMenus: {
          template: '<nav><slot name="left"/><slot name="center"/><slot name="right"/></nav>'
        },
        CardPanel: { template: '<section><slot name="body"/></section>' },
        ATabs: { name: "ATabs", props: ["activeKey"], template: "<div><slot/></div>" },
        ATabPane: pass,
        AInput: {
          name: "AInput",
          props: ["value"],
          emits: ["update:value"],
          template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)"/>'
        },
        AButton: { props: ["loading"], template: "<button><slot/></button>" },
        ABadge: {
          name: "ABadge",
          props: ["count"],
          template: "<span data-badge>{{ count }}</span>"
        }
      }
    }
  });
  wrappers.push(wrapper);
  await settle();
  return wrapper;
};

describe("production widget wiring", () => {
  it("sends the header query to the hook and displays all matching totals only on the active folder", async () => {
    const wrapper = await createWidget();
    expect(wrapper.findAll("[data-badge]").map((badge) => badge.text())).toEqual(["263"]);
    await wrapper.find("nav input").setValue("Toast");
    await vi.advanceTimersByTimeAsync(600);
    await settle();
    expect(api.list.mock.lastCall![0].params).toMatchObject({
      query: "Toast",
      folder: "mods",
      page: 1
    });
    expect(wrapper.findAll("[data-badge]").map((badge) => badge.text())).toEqual(["1"]);
    const local = wrapper.findAllComponents(LocalModTable)[0];
    expect(local.props("dataSource")[0].file).toBe("mods/Toast-1.0.jar.disabled");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "TXT_CODE_REFRESH")!
      .trigger("click");
    await settle();
    await api.uploadRefresh();
    await api.queueRefresh();
    expect(api.list.mock.lastCall![0].params.query).toBe("Toast");
    expect(api.remoteSearch).not.toHaveBeenCalled();
    wrapper.findComponent({ name: "ATabs" }).vm.$emit("update:activeKey", "TAB_KEY_PLUGINS");
    await settle();
    expect(api.list.mock.lastCall![0].params).toMatchObject({
      query: "Toast",
      folder: "plugins",
      page: 1
    });
    expect(wrapper.findAll("[data-badge]").map((badge) => badge.text())).toEqual(["1"]);
  });

  it("cancels installed search on Download, preserves the remote query and resumes installed search on return", async () => {
    const wrapper = await createWidget();
    await wrapper.find("nav input").setValue("Toast");
    wrapper.findComponent({ name: "ATabs" }).vm.$emit("update:activeKey", "TAB_KEY_DOWNLOAD");
    await settle();
    const count = api.list.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.list).toHaveBeenCalledTimes(count);
    expect(wrapper.findAll("[data-badge]")).toHaveLength(0);
    await api.uploadRefresh(); // Post-download/upload callbacks still refresh transfer status here.
    expect(api.list.mock.lastCall![0].params).toMatchObject({ query: "Toast", folder: "mods" });
    expect(
      wrapper
        .findAllComponents({ name: "AInput" })
        .some((input) => input.props("value") === "remote query")
    ).toBe(true);
    wrapper.findComponent({ name: "ATabs" }).vm.$emit("update:activeKey", "TAB_KEY_MODS");
    await settle();
    expect(api.list.mock.lastCall![0].params).toMatchObject({
      query: "Toast",
      folder: "mods",
      page: 1
    });
  });

  it("loads once per native Ant table page and size change", async () => {
    let flow!: ReturnType<typeof useLocalMods>;
    const wrapper = mount(
      defineComponent({
        setup() {
          flow = useLocalMods("instance", "daemon", vi.fn(), vi.fn());
          return () =>
            h(LocalModTable, {
              loading: flow.loading.value,
              dataSource: flow.mods.value,
              columns: [{ title: "Name", key: "name", dataIndex: "name" }],
              pagination: flow.tablePagination,
              onChange: flow.handleTableChange
            });
        }
      }),
      {
        global: {
          components: { ATable: Table },
          stubs: Object.fromEntries(
            [
              "AAvatar",
              "ATag",
              "ADropdown",
              "AButton",
              "AMenu",
              "AMenuItem",
              "ASpace",
              "APopconfirm"
            ].map((name) => [name, true])
          )
        }
      }
    );
    wrappers.push(wrapper);
    await flow.loadMods("mods");
    await settle();
    await wrapper.find(".ant-pagination-item-2").trigger("click");
    await settle();
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.list.mock.lastCall![0].params.page).toBe(2);
    // Invoke the native Pagination's size event: it also emits its regular change event.
    wrapper.findComponent({ name: "Pagination" }).vm.$emit("showSizeChange", 2, 100);
    wrapper.findComponent({ name: "Pagination" }).vm.$emit("change", 1, 100);
    await settle();
    expect(api.list).toHaveBeenCalledTimes(3);
    expect(api.list.mock.lastCall![0].params).toMatchObject({ page: 1, pageSize: 100 });
    expect(flow.mods.value).toHaveLength(100);
    wrapper.findComponent({ name: "Pagination" }).vm.$emit("showSizeChange", 1, 250);
    wrapper.findComponent({ name: "Pagination" }).vm.$emit("change", 1, 250);
    await settle();
    expect(api.list).toHaveBeenCalledTimes(4);
    expect(flow.mods.value).toHaveLength(250);
  });
});
