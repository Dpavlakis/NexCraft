import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, toRaw } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  page: vi.fn(),
  global: vi.fn(),
  info: vi.fn(),
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
    getInstanceInfo: () => {
      const state = ref();
      return {
        state,
        execute: async (request: any) => {
          state.value = await api.info(request);
          return state;
        }
      };
    }
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
vi.mock("@/widgets/instance/InstanceLine.vue", () => ({
  default: defineComponent({
    props: ["targetInstanceInfo"],
    setup(props) {
      if (!props.targetInstanceInfo) throw new Error("InstanceLine requires an instance");
      return () => h("span", { "data-instance-line": props.targetInstanceInfo.instanceUuid });
    }
  })
}));
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
import useLazyKVMap from "ant-design-vue/es/table/hooks/useLazyKVMap";
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
  stubs["a-table"] = defineComponent({
    props: ["dataSource"],
    setup(props, { slots }) {
      const flatten = (rows: any[]): any[] =>
        rows.flatMap((row) => [row, ...flatten(row.children || [])]);
      return () =>
        h(
          "div",
          flatten(props.dataSource || []).map(
            (record) => slots.bodyCell?.({ column: { key: "name" }, record })
          )
        );
    }
  });
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

describe("server grouping page and node scope", () => {
  it("groups only actual page metadata and opens every batch card even after collapse", async () => {
    const currentPage = page("pack", "custom");
    Object.assign(currentPage.data[0].config, { packInfo: { source: "curseforge" } });
    api.page.mockResolvedValue(currentPage);
    const { vm, wrapper } = await host(nodeB);
    expect(vm.serverGroups.map((g: any) => g.items.map((i: any) => i.instanceUuid))).toEqual([
      ["pack"],
      ["custom"]
    ]);
    const packToggle = wrapper.get('[data-server-group="modpack"] .server-group-toggle');
    await packToggle.trigger("click");
    expect(wrapper.find('[data-instance="pack"]').exists()).toBe(false);
    vm.multipleMode = true;
    await nextTick();
    vm.selectAllInstances();
    await packToggle.trigger("click");
    expect(
      wrapper.findAll("[data-instance]").map((row) => row.attributes("data-instance"))
    ).toEqual(["pack", "custom"]);
    expect(vm.selectedInstance.map((row: any) => row.instanceUuid)).toEqual(["pack", "custom"]);
    await vm.batchOperation("start");
    expect(api.start).toHaveBeenCalledExactlyOnceWith({
      data: [
        { instanceUuid: "pack", daemonId: "node-b" },
        { instanceUuid: "custom", daemonId: "node-b" }
      ]
    });
  });
  it("keeps both labelled sections when a filtered page has only custom instances", async () => {
    const { wrapper, vm } = await host(nodeB);
    expect(wrapper.findAll("[data-server-group]")).toHaveLength(2);
    expect(vm.serverGroups.map((group: any) => group.items.length)).toEqual([0, 1]);
  });
  it("derives per-node table groups without mutating raw rows and keeps load-more at node level", async () => {
    const pack = { ...instance("pack-a"), config: { packInfo: { source: "ftb" } } };
    api.global.mockResolvedValue({
      "node-a": { instances: [pack, instance("custom-a")], page: 1, maxPage: 3 },
      "node-b": { instances: [instance("custom-b")], page: 1, maxPage: 1 }
    });
    const { vm, wrapper } = await host(globalNode as any);
    const raw = vm.tableTreeData[0];
    expect(raw.children.map((row: any) => row.key)).toEqual([
      "pack-a",
      "custom-a",
      "node-a-load-more"
    ]);
    const grouped = vm.groupedTableTreeData[0];
    expect(grouped.children.map((row: any) => row.key)).toEqual([
      "node-a:group:modpack",
      "node-a:group:custom",
      "node-a-load-more"
    ]);
    expect(grouped.children[0].children[0]).not.toBe(raw.children[0]);
    expect(grouped.children[0].children[0].inst).toBe(raw.children[0].inst);
    expect(grouped.children[1].children.map((row: any) => row.daemonId)).toEqual(["node-a"]);
    expect(vm.groupedTableTreeData[1].children[1].children.map((row: any) => row.daemonId)).toEqual(
      ["node-b"]
    );
    expect(wrapper.findAll("[data-instance-line]")).toHaveLength(3);
    api.page.mockResolvedValueOnce(page("custom-a-page-2"));
    await vm.loadMoreInstances("node-a");
    await flush();
    expect(api.page).toHaveBeenLastCalledWith({
      params: {
        page: 2,
        page_size: 10,
        status: "",
        instance_name: "",
        tag: "[]",
        daemonId: "node-a"
      }
    });
    expect(vm.tableTreeData[0].children.every((row: any) => !row.isServerGroup)).toBe(true);
    expect(vm.groupedTableTreeData[0].children[1].count).toBe(2);
    expect(vm.groupedTableTreeData[0].children.some((row: any) => row.isLoadMore)).toBe(false);
  });
  it("gives duplicate UUIDs distinct flattened table keys while preserving raw refresh targets", async () => {
    const uuid = "same-instance-uuid";
    api.global.mockResolvedValue({
      "node-a": { instances: [instance(uuid)], page: 1, maxPage: 2 },
      "node-b": { instances: [instance(uuid)], page: 1, maxPage: 1 }
    });
    const { vm } = await host(globalNode as any);
    const before = JSON.stringify(vm.tableTreeData);
    const projected = ref(vm.groupedTableTreeData);
    const flatten = (rows: any[]): any[] =>
      rows.flatMap((row) => [row, ...flatten(row.children || [])]);
    const allRows = flatten(projected.value);
    expect(new Set(allRows.map((row) => row.key)).size).toBe(allRows.length);
    const leaves = allRows.filter((row) => row.inst);
    expect(leaves).toHaveLength(2);
    const [lookup] = useLazyKVMap(
      projected,
      ref("children"),
      ref((row: any) => row.key)
    );
    for (const leaf of leaves) {
      expect(lookup(leaf.key)).toBe(leaf);
      expect(leaf.inst.instanceUuid).toBe(uuid);
      const raw = vm.tableTreeData.find((node: any) => node.key === leaf.daemonId).children[0];
      expect(leaf.key).not.toBe(raw.key);
      expect(raw.key).toBe(uuid);
      expect(toRaw(leaf.inst)).toBe(toRaw(raw.inst));
    }
    expect(JSON.stringify(vm.tableTreeData)).toBe(before);
    const nodeALeaf = leaves[0];
    api.info.mockResolvedValue({
      ...instance(uuid),
      config: { nickname: "refreshed B", packInfo: { source: "modrinth" } }
    });
    await vm.initInstancesData(false, leaves[1].daemonId, leaves[1].inst.instanceUuid);
    await flush();
    expect(api.info).toHaveBeenCalledExactlyOnceWith({
      params: { uuid, daemonId: "node-b" }
    });
    expect(vm.tableTreeData[0].children[0].inst.config.nickname).toBe(uuid);
    expect(vm.tableTreeData[1].children[0].key).toBe(uuid);
    expect(vm.tableTreeData[1].children[0].inst.config.nickname).toBe("refreshed B");
    expect(vm.groupedTableTreeData[1].children[0].count).toBe(1);
    expect(vm.groupedTableTreeData[1].children[1].count).toBe(0);
    expect(vm.groupedTableTreeData[1].children[0].children[0].key).toBe(leaves[1].key);
    expect(vm.groupedTableTreeData[0].children[1].children[0].key).toBe(nodeALeaf.key);
  });

  it("retains collapsed table preferences and node ownership through loaded-page background refresh", async () => {
    api.global.mockResolvedValue({
      "node-a": { instances: [instance("a-1")], page: 1, maxPage: 3 },
      "node-b": { instances: [instance("b-1")], page: 1, maxPage: 1 }
    });
    const { vm } = await host(globalNode as any);
    api.page.mockResolvedValueOnce({ ...page("a-2"), maxPage: 3 });
    await vm.loadMoreInstances("node-a");
    vm.setTableExpanded(false, vm.groupedTableTreeData[0].children[1]);
    expect(vm.expandedTableKeys).not.toContain("node-a:group:custom");
    api.page.mockClear();
    api.page.mockImplementation(async ({ params }) => ({
      ...page(`${params.daemonId}-refreshed-${params.page}`),
      maxPage: 3
    }));
    await vm.refreshVisibleInstances();
    await flush();
    expect(
      api.page.mock.calls.map(([request]) => [request.params.daemonId, request.params.page])
    ).toEqual([
      ["node-a", 1],
      ["node-a", 2],
      ["node-b", 1]
    ]);
    expect(vm.tableTreeData[0].children.map((row: any) => row.key)).toEqual([
      "node-a-refreshed-1",
      "node-a-refreshed-2",
      "node-a-load-more"
    ]);
    expect(vm.tableTreeData[1].children[0].key).toBe("node-b-refreshed-1");
    expect(vm.groupedTableTreeData[0].children[1].count).toBe(2);
    expect(vm.expandedTableKeys).not.toContain("node-a:group:custom");
    expect(vm.expandedTableKeys).toContain("node-b:group:custom");
  });

  it("keeps page selection and skips background refresh while batch groups are forced open", async () => {
    const { vm, wrapper } = await host(nodeB);
    await wrapper.get('[data-server-group="custom"] .server-group-toggle').trigger("click");
    vm.multipleMode = true;
    vm.selectAllInstances();
    await nextTick();
    api.page.mockClear();
    await vm.refreshVisibleInstances();
    expect(api.page).not.toHaveBeenCalled();
    expect(vm.selectedInstance.map((row: any) => row.instanceUuid)).toEqual(["b-1"]);
    expect(wrapper.find('[data-instance="b-1"]').exists()).toBe(true);
  });
  it("limits global refresh to four page requests and discards results after a query change", async () => {
    api.global.mockResolvedValue({
      "node-a": { instances: [instance("a-1")], page: 3, maxPage: 3 },
      "node-b": { instances: [instance("b-1")], page: 3, maxPage: 3 }
    });
    const { vm } = await host(globalNode as any);
    const before = JSON.stringify(vm.tableTreeData);
    const pending = Array.from({ length: 6 }, deferred);
    let active = 0,
      peak = 0,
      started = 0;
    api.page.mockImplementation(async () => {
      const job = pending[started++];
      peak = Math.max(peak, ++active);
      try {
        return await job.promise;
      } finally {
        --active;
      }
    });
    const refreshing = vm.refreshVisibleInstances();
    await flush();
    expect(started).toBe(4);
    pending[0].resolve(page("updated-a"));
    await flush();
    expect(started).toBe(5);
    pending[1].resolve(page("updated-a-2"));
    await flush();
    expect(started).toBe(6);
    expect(peak).toBe(4);
    vm.operationForm.instanceName = "new filter";
    pending.slice(2).forEach((job) => job.resolve(page("stale")));
    await refreshing;
    expect(JSON.stringify(vm.tableTreeData)).toBe(before);
  });
});
