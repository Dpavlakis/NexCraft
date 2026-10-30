import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  page: vi.fn(),
  global: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  kill: vi.fn(),
  delete: vi.fn(),
  confirm: vi.fn(),
  report: vi.fn(),
  updateTips: vi.fn(),
  push: vi.fn()
}));
vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/config/router", () => ({ router: { push: api.push } }));
vi.mock("@/hooks/useScreen", () => ({ useScreen: () => ({ isPhone: ref(false) }) }));
vi.mock("@/hooks/useInstance", () => ({
  TYPE_UNIVERSAL: "universal",
  useInstanceMoreDetail: (info: any) => info
}));
vi.mock("@/tools/nodes", () => ({
  computeNodeName: (_ip: string, _available: boolean, remarks: string) => remarks
}));
vi.mock("@/tools/validator", () => ({ reportErrorMsg: api.report }));
vi.mock("@/hooks/useInstanceTag", () => ({
  useInstanceTagTips: () => ({ updateTagTips: api.updateTips, tagTips: ref([]) }),
  useInstanceTagSearch: () => {
    const tags = ref<string[]>([]);
    return {
      tags,
      setRefreshFn: vi.fn(),
      selectTag: vi.fn(),
      removeTag: vi.fn(),
      isTagSelected: () => false,
      clearTags: () => {
        tags.value = [];
      }
    };
  }
}));
vi.mock("@/services/apis", () => ({
  remoteNodeList: () => {
    const state = ref();
    return {
      state,
      isLoading: ref(false),
      execute: async () => {
        state.value = [nodeA, nodeB];
        return state;
      }
    };
  },
  remoteInstances: () => {
    const state = ref();
    const isLoading = ref(false);
    return {
      state,
      isLoading,
      execute: async (request: any) => {
        isLoading.value = true;
        try {
          state.value = await api.page(request);
          return state;
        } finally {
          isLoading.value = false;
        }
      }
    };
  },
  remoteInstancesGlobal: () => {
    const state = ref();
    return {
      state,
      execute: async (request: any) => {
        state.value = await api.global(request);
        return state;
      }
    };
  }
}));
vi.mock("@/services/apis/instance", () => {
  const operation = (execute: any) => () => ({ execute, state: ref(true) });
  return {
    batchStart: operation(api.start),
    batchStop: operation(api.stop),
    batchRestart: operation(api.restart),
    batchKill: operation(api.kill),
    batchDelete: operation(api.delete),
    getInstanceInfo: vi.fn()
  };
});
vi.mock("ant-design-vue", () => ({
  Modal: { confirm: api.confirm },
  notification: { success: vi.fn() }
}));
vi.mock("@ant-design/icons-vue", () => {
  const icon = { render: () => null };
  return Object.fromEntries(
    [
      "AppstoreOutlined",
      "CloseOutlined",
      "DatabaseOutlined",
      "DeleteOutlined",
      "DownOutlined",
      "FormOutlined",
      "FrownOutlined",
      "InfoCircleOutlined",
      "PoweroffOutlined",
      "PlayCircleOutlined",
      "RedoOutlined",
      "SearchOutlined",
      "WarningOutlined"
    ].map((name) => [name, icon])
  );
});
vi.mock("@/components/BetweenMenus.vue", () => ({
  default: defineComponent({
    setup(_, { slots }) {
      return () =>
        h(
          "div",
          Object.values(slots).flatMap((slot) => slot?.() || [])
        );
    }
  })
}));
vi.mock("@/widgets/instance/InstanceLine.vue", () => ({ default: { render: () => null } }));
vi.mock("@/widgets/instance/Shortcut.vue", () => ({
  default: defineComponent({
    props: ["targetInstanceInfo", "targetDaemonId"],
    setup(props) {
      return () =>
        h(
          "button",
          {
            "data-instance": props.targetInstanceInfo.instanceUuid,
            "data-daemon": props.targetDaemonId
          },
          props.targetInstanceInfo.instanceUuid
        );
    }
  })
}));
import InstanceList from "@/widgets/InstanceList.vue";
import { ALL_DAEMON_MODE } from "@/config/const";
const nodeA = { uuid: "node-a", available: true, ip: "a", remarks: "A" };
const nodeB = { uuid: "node-b", available: true, ip: "b", remarks: "B" };
const globalNode = { uuid: ALL_DAEMON_MODE, available: true };
const instance = (uuid: string) => ({
  instanceUuid: uuid,
  config: { nickname: uuid, cwd: "/servers/" + uuid }
});
const page = (...uuids: string[]) => ({
  data: uuids.map(instance),
  allTags: [],
  maxPage: 2,
  page: 1,
  pageSize: 20
});
function deferred() {
  let resolve!: (value: any) => void, reject!: (error: Error) => void;
  const promise = new Promise<any>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
  await nextTick();
};
const hosts: VueWrapper[] = [];
async function host(initial = nodeA) {
  localStorage.setItem("pageSelectedRemote", JSON.stringify(initial));
  const passthrough = defineComponent({
    setup(_, { slots }) {
      return () => h("div", [slots.default?.(), slots.overlay?.()]);
    }
  });
  const stubs: Record<string, any> = Object.fromEntries(
    [
      "a-row",
      "a-col",
      "a-dropdown",
      "a-menu",
      "a-menu-item",
      "a-menu-divider",
      "a-button",
      "a-input-group",
      "a-select",
      "a-select-option",
      "a-input",
      "a-typography-title",
      "a-typography-text",
      "a-pagination",
      "a-tag",
      "fade-up-animation",
      "Loading",
      "Empty"
    ].map((name) => [name, passthrough])
  );
  stubs["a-table"] = { render: () => null };
  const wrapper = mount(InstanceList, {
    props: { card: { title: "Instances" } as any },
    global: { stubs }
  });
  hosts.push(wrapper);
  await flush();
  return { wrapper, vm: (wrapper.vm as any).$.setupState as any };
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.page.mockImplementation(async ({ params }) =>
    page(params.daemonId === nodeB.uuid ? "b-1" : "a-1")
  );
  api.global.mockResolvedValue({
    "node-a": { instances: [instance("a-hidden"), instance("b-1")], page: 1, maxPage: 1 },
    "node-b": { instances: [instance("b-old-page")], page: 1, maxPage: 1 }
  });
  for (const op of [api.start, api.stop, api.restart, api.kill, api.delete])
    op.mockResolvedValue(ref(true));
  api.confirm.mockReturnValue({ destroy: vi.fn() });
});
afterEach(() => {
  hosts.splice(0).forEach((w) => w.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("instance list batch owner", () => {
  it.each(["start", "stop", "restart", "kill"] as const)(
    "submits only the visible node B page for %s after visiting global mode",
    async (operation) => {
      const { vm, wrapper } = await host(globalNode as any);
      await vm.handleChangeNode(nodeB);
      await flush();
      vm.multipleMode = true;
      vm.selectAllInstances();
      expect(vm.selectedInstance.map((item: any) => item.instanceUuid)).toEqual(["b-1"]);
      expect(
        wrapper.findAll("[data-instance]").map((item) => item.attributes("data-instance"))
      ).toEqual(["b-1"]);
      await vm.batchOperation(operation);
      await flush();
      expect(api[operation]).toHaveBeenCalledExactlyOnceWith({
        data: [{ instanceUuid: "b-1", daemonId: "node-b" }]
      });
    }
  );
  it.each([false, true])("captures node B UUIDs for deleteFile=%s", async (deleteFile) => {
    const { vm } = await host(globalNode as any);
    await vm.handleChangeNode(nodeB);
    vm.multipleMode = true;
    vm.selectAllInstances();
    await vm.batchDeleteInstance(deleteFile);
    await api.confirm.mock.calls[0][0].onOk();
    expect(api.delete).toHaveBeenCalledExactlyOnceWith({
      params: { daemonId: "node-b" },
      data: { uuids: ["b-1"], deleteFile }
    });
  });
  it("cannot select or submit old node A rows while node B is pending", async () => {
    const { vm } = await host();
    const pending = deferred();
    api.page.mockReturnValueOnce(pending.promise);
    const changing = vm.handleChangeNode(nodeB);
    vm.multipleMode = true;
    vm.selectAllInstances();
    await vm.batchOperation("start");
    await vm.batchDeleteInstance(false);
    expect(vm.selectedInstance).toHaveLength(0);
    expect(api.start).not.toHaveBeenCalled();
    expect(api.confirm).not.toHaveBeenCalled();
    pending.resolve(page("b-1"));
    await changing;
    vm.selectAllInstances();
    await vm.batchOperation("start");
    await flush();
    expect(api.start).toHaveBeenCalledExactlyOnceWith({
      data: [{ instanceUuid: "b-1", daemonId: "node-b" }]
    });
  });
  it("hides cached A cards when loading node B fails, then recovers on refresh", async () => {
    const { vm, wrapper } = await host();
    api.page.mockRejectedValueOnce(new Error("node B unavailable"));
    await vm.handleChangeNode(nodeB);
    await flush();
    expect(wrapper.findAll("[data-instance]")).toHaveLength(0);
    vm.multipleMode = true;
    vm.selectAllInstances();
    await vm.batchOperation("start");
    expect(api.start).not.toHaveBeenCalled();
    await vm.initInstancesData();
    await flush();
    vm.selectAllInstances();
    await vm.batchOperation("start");
    expect(api.start).toHaveBeenCalledExactlyOnceWith({
      data: [{ instanceUuid: "b-1", daemonId: "node-b" }]
    });
  });
  it("admits only the latest identical refresh, even when requests finish in reverse order", async () => {
    const { vm, wrapper } = await host(nodeB);
    const old = deferred(),
      latest = deferred();
    api.page.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const a = vm.initInstancesData(),
      b = vm.initInstancesData();
    latest.resolve(page("b-new"));
    await b;
    old.resolve(page("b-old"));
    await a;
    await flush();
    expect(
      wrapper.findAll("[data-instance]").map((row) => row.attributes("data-instance"))
    ).toEqual(["b-new"]);
    vm.multipleMode = true;
    vm.selectAllInstances();
    await vm.batchOperation("stop");
    expect(api.stop).toHaveBeenCalledExactlyOnceWith({
      data: [{ instanceUuid: "b-new", daemonId: "node-b" }]
    });
  });
  it.each(["resolve", "reject"] as const)(
    "ignores a stale node A %s after node B finishes",
    async (outcome) => {
      const { vm, wrapper } = await host();
      const pending = deferred();
      api.page.mockReturnValueOnce(pending.promise);
      const old = vm.initInstancesData();
      await vm.handleChangeNode(nodeB);
      if (outcome === "resolve") pending.resolve(page("a-late"));
      else pending.reject(new Error("stale"));
      await old;
      await flush();
      vm.multipleMode = true;
      vm.selectAllInstances();
      await vm.batchOperation("start");
      await flush();
      expect(api.start).toHaveBeenCalledExactlyOnceWith({
        data: [{ instanceUuid: "b-1", daemonId: "node-b" }]
      });
      expect(wrapper.find("[data-instance='a-late']").exists()).toBe(false);
      expect(api.report).not.toHaveBeenCalled();
    }
  );
  it.each(["node", "page", "filter", "away-back", "unmount"])(
    "does not submit a delete confirmation after a %s change",
    async (change) => {
      const { vm, wrapper } = await host(nodeB);
      vm.multipleMode = true;
      vm.selectAllInstances();
      await vm.batchDeleteInstance(true);
      const confirm = api.confirm.mock.calls[0][0];
      if (change === "node") await vm.handleChangeNode(nodeA);
      if (change === "page") {
        vm.operationForm.currentPage = 2;
        await vm.initInstancesData();
      }
      if (change === "filter") vm.operationForm.instanceName = "changed";
      if (change === "away-back") {
        await vm.handleChangeNode(nodeA);
        await vm.handleChangeNode(nodeB);
      }
      if (change === "unmount") wrapper.unmount();
      await nextTick();
      await confirm.onOk();
      expect(api.delete).not.toHaveBeenCalled();
    }
  );
  it("selects only the newly loaded filtered page and preserves its pagination request", async () => {
    const { vm } = await host(nodeB);
    vm.multipleMode = true;
    vm.selectAllInstances();
    vm.operationForm.currentPage = 2;
    vm.operationForm.pageSize = 10;
    vm.operationForm.status = "3";
    vm.operationForm.type = "java";
    vm.operationForm.instanceName = " beta ";
    api.page.mockResolvedValueOnce(page("b-page-2"));
    await vm.initInstancesData();
    vm.selectAllInstances();
    expect(api.page).toHaveBeenLastCalledWith({
      params: {
        daemonId: "node-b",
        page: 2,
        page_size: 10,
        status: "3",
        type: "java",
        instance_name: "beta",
        tag: "[]"
      }
    });
    await vm.batchOperation("kill");
    expect(api.kill).toHaveBeenCalledExactlyOnceWith({
      data: [{ instanceUuid: "b-page-2", daemonId: "node-b" }]
    });
  });
  it("clears selection immediately on a query change before the throttled request", async () => {
    const { vm } = await host(nodeB);
    vm.multipleMode = true;
    vm.selectAllInstances();
    vm.operationForm.currentPage = 2;
    await nextTick();
    expect(vm.selectedInstance).toHaveLength(0);
    vm.selectAllInstances();
    await vm.batchOperation("restart");
    expect(api.restart).not.toHaveBeenCalled();
  });
  it("deduplicates the visible page and leaves normal single-card navigation working", async () => {
    api.page.mockResolvedValue(page("b-1", "b-1", "b-2"));
    const { vm } = await host(nodeB);
    vm.handleSelectInstance(instance("b-1"));
    expect(api.push).toHaveBeenCalledWith({
      path: "/instances/terminal",
      query: { daemonId: "node-b", instanceId: "b-1" }
    });
    vm.multipleMode = true;
    vm.selectAllInstances();
    expect(vm.selectedInstance.map((item: any) => item.instanceUuid)).toEqual(["b-1", "b-2"]);
    vm.selectInstance(instance("b-1"));
    expect(vm.selectedInstance.map((item: any) => item.instanceUuid)).toEqual(["b-2"]);
  });
});
