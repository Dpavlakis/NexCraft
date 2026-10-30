import { mount, type VueWrapper } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, ref, type Component } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  page: vi.fn(),
  global: vi.fn(),
  start: vi.fn(),
  mounts: vi.fn(),
  globalRef: vi.fn(),
  push: vi.fn(),
  icon: vi.fn()
}));
vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/config/router", () => ({ router: { push: api.push } }));
vi.mock("@/hooks/useScreen", () => ({ useScreen: () => ({ isPhone: ref(false) }) }));
vi.mock("@/hooks/useInstance", () => ({
  TYPE_UNIVERSAL: "universal",
  useInstanceMoreDetail: (info: any) => info,
  verifyEULA: vi.fn(),
  useInstanceInfo: (options: any) => ({
    instanceInfo: options.instanceInfo,
    statusText: ref("Running"),
    isRunning: computed(() => options.instanceInfo.value.status === 3),
    isStopped: computed(() => options.instanceInfo.value.status === 0),
    isStarting: ref(false),
    instanceTypeText: ref("Java server")
  })
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
  getInstanceInfo: vi.fn(),
  ...Object.fromEntries(
    ["openInstance", "stopInstance", "restartInstance", "killInstance", "updateInstance"].map(
      (name) => [name, () => ({ execute: vi.fn(), isLoading: ref(false) })]
    )
  )
}));
vi.mock("@/tools/validator", () => ({ reportErrorMsg: vi.fn() }));
vi.mock("ant-design-vue", () => ({
  Modal: { confirm: vi.fn() },
  notification: { success: vi.fn() },
  message: { success: vi.fn() }
}));
vi.mock("@/hooks/useAppRouters", () => ({ useAppRouters: () => ({ toPage: api.push }) }));
vi.mock("@/hooks/useCardTools", () => ({
  useLayoutCardTools: () => ({ getMetaOrRouteValue: () => undefined })
}));
vi.mock("@/hooks/useFileManager", () => ({ getFileConfigAddr: () => "http://localhost" }));
vi.mock("@/stores/useLayoutContainerStore", () => ({
  useLayoutContainerStore: () => ({ containerState: { isDesignMode: false } })
}));
vi.mock("@/services/apis/fileManager", () => ({ downloadAddress: () => ({ execute: api.icon }) }));
vi.mock("@/components/InstanceVersionInfo.vue", () => ({
  default: {
    props: ["instance", "daemonId"],
    template: "<div data-versions>{{ instance.config.packInfo?.versionName }}</div>"
  }
}));
vi.mock("@/components/InstanceSecondaryActions.vue", () => ({ default: { template: "<div />" } }));
const CardProbe = defineComponent({
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
});
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
const stubs: Record<string, Component> = Object.fromEntries(
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
stubs["a-button"] = defineComponent({
  props: ["disabled"],
  setup(props, { slots }) {
    return () => h("button", { disabled: props.disabled }, slots.default?.());
  }
});
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await nextTick();
};
const item = (uuid: string, source?: string) => ({
  instanceUuid: uuid,
  status: 3,
  config: {
    nickname: uuid,
    type: "minecraft/java",
    tag: [],
    packInfo: { source, versionName: "Installed pack" }
  },
  info: { memoryUsage: 0 }
});
async function host(global = false, nativeCards = false) {
  localStorage.setItem(
    "pageSelectedRemote",
    JSON.stringify({ uuid: global ? ALL_DAEMON_MODE : "node-a", available: true })
  );
  const wrapper = mount(InstanceList, {
    props: { card: { title: "Servers" } as any },
    global: { stubs: { ...stubs, ...(nativeCards ? {} : { Shortcut: CardProbe }) } }
  });
  wrappers.push(wrapper);
  await flush();
  return { wrapper, vm: (wrapper.vm as any).$.setupState };
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.icon.mockResolvedValue(ref());
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
  it("immediately navigates from native cards after repeated switches without waiting, remounting or fetching", async () => {
    const { wrapper, vm } = await host(false, true);
    const card = wrapper
      .findAll("article")
      .find((card) => card.attributes("aria-label") === "pack-2")!;
    const element = card.element;
    const versions = card.get("[data-versions]").element;
    const owner = vm.loadedPage;
    const cache = vm.instances;
    const now = Date.now();
    for (const layout of ["list", "overview", "compact", "list", "overview", "compact"]) {
      await wrapper.get('button[data-layout="' + layout + '"]').trigger("click");
      expect(card.classes()).toContain("layout-" + layout);
      for (const region of [
        "h3",
        ".server-address > .server-label",
        "[data-versions]",
        ".server-actions",
        ".console-action"
      ]) {
        api.push.mockClear();
        await card.get(region).trigger("click");
        expect(api.push, layout + " " + region).toHaveBeenCalledExactlyOnceWith({
          path: "/instances/terminal",
          query: { daemonId: "node-a", instanceId: "pack-2" }
        });
      }
      expect(card.element).toBe(element);
      expect(card.get("[data-versions]").element).toBe(versions);
      expect(vm.loadedPage).toBe(owner);
      expect(vm.instances).toBe(cache);
    }
    for (const key of ["End", "Home", "ArrowRight", "ArrowRight", "ArrowRight"]) {
      api.push.mockClear();
      await wrapper.get('button[aria-checked="true"]').trigger("keydown", { key });
      await card.get("[data-versions]").trigger("click");
      expect(api.push).toHaveBeenCalledExactlyOnceWith({
        path: "/instances/terminal",
        query: { daemonId: "node-a", instanceId: "pack-2" }
      });
      expect(card.element).toBe(element);
      expect(vm.loadedPage).toBe(owner);
    }
    expect(Date.now()).toBe(now);
    expect(api.page).toHaveBeenCalledOnce();
    expect(api.icon).toHaveBeenCalledTimes(3);
    api.push.mockClear();
    vm.multipleMode = true;
    await nextTick();
    await wrapper.get('button[data-layout="list"]').trigger("click");
    await card.get("[data-versions]").trigger("click");
    expect(vm.selectedInstance.map((item: any) => item.instanceUuid)).toEqual(["pack-2"]);
    expect(api.push).not.toHaveBeenCalled();
  });

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
