import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  page: vi.fn(),
  global: vi.fn(),
  start: vi.fn(),
  mounts: vi.fn(),
  globalRef: vi.fn()
}));
vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/config/router", () => ({ router: { push: vi.fn() } }));
vi.mock("@/hooks/useScreen", () => ({ useScreen: () => ({ isPhone: ref(false) }) }));
vi.mock("@/hooks/useInstance", () => ({
  TYPE_UNIVERSAL: "universal",
  useInstanceMoreDetail: (info: any) => info
}));
vi.mock("@/hooks/useInstanceTag", () => ({
  useInstanceTagTips: () => ({ updateTagTips: vi.fn(), tagTips: ref([]) }),
  useInstanceTagSearch: () => ({
    tags: ref([]),
    setRefreshFn: vi.fn(),
    selectTag: vi.fn(),
    removeTag: vi.fn(),
    isTagSelected: () => false,
    clearTags: vi.fn()
  })
}));
vi.mock("@/services/apis", () => ({
  remoteNodeList: () => {
    const state = ref<any>();
    return {
      state,
      isLoading: ref(false),
      execute: async () => {
        state.value = [{ uuid: "node-a", available: true, ip: "localhost" }];
        return state;
      }
    };
  },
  remoteInstances: () => {
    const state = ref();
    return {
      state,
      execute: async (params: any) => {
        state.value = await api.page(params);
        return state;
      }
    };
  },
  remoteInstancesGlobal: () => {
    const state = ref();
    return {
      state,
      execute: async () => {
        state.value = await api.global();
        return state;
      }
    };
  }
}));
vi.mock("@/services/apis/instance", () => ({
  batchStart: () => ({ execute: api.start }),
  batchStop: vi.fn(),
  batchRestart: vi.fn(),
  batchKill: vi.fn(),
  batchDelete: vi.fn(),
  getInstanceInfo: vi.fn()
}));
vi.mock("@/tools/validator", () => ({ reportErrorMsg: vi.fn() }));
vi.mock("ant-design-vue", () => ({
  Modal: { confirm: vi.fn() },
  notification: { success: vi.fn() }
}));
vi.mock("@/widgets/instance/Shortcut.vue", () => ({
  default: defineComponent({
    props: ["targetInstanceInfo", "layout", "disabled"],
    setup(props) {
      api.mounts();
      return () =>
        h(
          "button",
          { "data-card": props.targetInstanceInfo.instanceUuid, "data-layout": props.layout },
          props.targetInstanceInfo.instanceUuid
        );
    }
  })
}));
vi.mock("@/widgets/instance/InstanceLine.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/BetweenMenus.vue", () => ({
  default: defineComponent({
    setup(_, { slots }) {
      return () => h("div", [slots.left?.(), slots.center?.(), slots.right?.()]);
    }
  })
}));
import InstanceList from "@/widgets/InstanceList.vue";
import { ALL_DAEMON_MODE } from "@/config/const";
const wrappers: VueWrapper[] = [];
const pass = defineComponent({
  setup(_, { slots }) {
    return () => h("div", [slots.default?.(), slots.overlay?.()]);
  }
});
const stubs = Object.fromEntries(
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
    "a-tooltip",
    "fade-up-animation",
    "Loading",
    "Empty",
    "a-table"
  ].map((name) => [name, pass])
);
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await nextTick();
};
const item = (uuid: string, source?: string) => ({
  instanceUuid: uuid,
  config: { nickname: uuid, packInfo: { source } }
});
async function host(global = false) {
  localStorage.setItem(
    "pageSelectedRemote",
    JSON.stringify({ uuid: global ? ALL_DAEMON_MODE : "node-a", available: true })
  );
  const wrapper = mount(InstanceList, {
    props: { card: { title: "Servers" } as any },
    global: { stubs }
  });
  wrappers.push(wrapper);
  await flush();
  return { wrapper, vm: (wrapper.vm as any).$.setupState };
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.page.mockResolvedValue({
    data: [item("pack-1", "modrinth"), item("custom"), item("pack-2", "curseforge")],
    allTags: [],
    maxPage: 1
  });
  api.global.mockResolvedValue({ "node-a": { instances: [item("global")], page: 1, maxPage: 1 } });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("server layouts in the production list", () => {
  it("switches stable card instances without requests, selection or page changes; remembers the choice", async () => {
    const { wrapper, vm } = await host();
    const cards = wrapper.findAll("[data-card]").map((card) => card.element);
    const owner = vm.loadedPage;
    const form = JSON.stringify(vm.operationForm);
    expect(api.mounts).toHaveBeenCalledTimes(3);
    for (const layout of ["list", "overview", "compact"]) {
      await wrapper.get('button[data-layout="' + layout + '"]').trigger("click");
      expect(wrapper.findAll("[data-card]").map((card) => card.element)).toEqual(cards);
      expect(wrapper.findAll("[data-card]").map((card) => card.attributes("data-layout"))).toEqual([
        layout,
        layout,
        layout
      ]);
      expect(vm.loadedPage).toBe(owner);
      expect(JSON.stringify(vm.operationForm)).toBe(form);
      expect(localStorage.getItem("nexcraft.server-list.layout")).toBe(layout);
    }
    expect(api.page).toHaveBeenCalledOnce();
    expect(api.mounts).toHaveBeenCalledTimes(3);
    await wrapper.get('button[data-layout="overview"]').trigger("click");
    wrapper.unmount();
    const fresh = await host();
    expect(fresh.vm.serverLayout).toBe("overview");
  });
  it("retains selected ownership and batch unfolding when changing layout", async () => {
    const { wrapper, vm } = await host();
    await wrapper.get('[data-server-group="modpack"] .server-group-toggle').trigger("click");
    vm.multipleMode = true;
    await nextTick();
    vm.selectAllInstances();
    await nextTick();
    const selected = vm.selectedInstance;
    const owner = vm.loadedPage;
    await wrapper.get('button[data-layout="list"]').trigger("click");
    expect(vm.selectedInstance).toBe(selected);
    expect(vm.loadedPage).toBe(owner);
    expect(wrapper.findAll("[data-card]").map((card) => card.attributes("data-card"))).toEqual([
      "pack-1",
      "pack-2",
      "custom"
    ]);
    await vm.batchOperation("start");
    expect(api.start).toHaveBeenCalledWith({
      data: ["pack-1", "custom", "pack-2"].map((instanceUuid) => ({
        instanceUuid,
        daemonId: "node-a"
      }))
    });
  });
  it("falls back from invalid or inaccessible storage and still switches in memory", async () => {
    localStorage.setItem("nexcraft.server-list.layout", "corrupt");
    const first = await host();
    expect(first.vm.serverLayout).toBe("compact");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private storage");
    });
    const second = await host();
    expect(second.vm.serverLayout).toBe("compact");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage full");
    });
    await second.wrapper.get('button[data-layout="list"]').trigger("click");
    expect(second.vm.serverLayout).toBe("list");
    expect(api.page).toHaveBeenCalledTimes(2);
  });
  it("hides the selector in global mode and retains the daemon hierarchy", async () => {
    localStorage.setItem("nexcraft.server-list.layout", "overview");
    const { wrapper, vm } = await host(true);
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
    expect(wrapper.find("[data-card]").exists()).toBe(false);
    expect(vm.tableTreeData[0].key).toBe("node-a");
    expect(vm.tableTreeData[0].children[0].key).toBe("global");
    expect(api.global).toHaveBeenCalledOnce();
    expect(api.page).not.toHaveBeenCalled();
    expect(vm.serverLayout).toBe("overview");
  });
});
