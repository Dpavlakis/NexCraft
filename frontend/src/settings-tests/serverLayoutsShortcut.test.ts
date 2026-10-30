import { mount, type VueWrapper } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installedInstanceVersions } from "@/tools/instanceVersions";
const api = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  kill: vi.fn(),
  update: vi.fn(),
  icon: vi.fn(),
  eula: vi.fn(),
  confirm: vi.fn(),
  push: vi.fn(),
  cardClick: vi.fn(),
  hook: vi.fn(),
  versionMount: vi.fn(),
  success: vi.fn()
}));
const state = reactive({ isDesignMode: false });
vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/hooks/useAppRouters", () => ({ useAppRouters: () => ({ toPage: api.push }) }));
vi.mock("@/hooks/useCardTools", () => ({
  useLayoutCardTools: () => ({ getMetaOrRouteValue: () => undefined })
}));
vi.mock("@/hooks/useFileManager", () => ({ getFileConfigAddr: () => "http://localhost" }));
vi.mock("@/hooks/useInstance", () => ({
  TYPE_UNIVERSAL: "universal",
  verifyEULA: api.eula,
  useInstanceInfo: (options: any) => {
    api.hook();
    const instanceInfo = options.instanceInfo;
    return {
      instanceInfo,
      statusText: computed(() => String(instanceInfo.value.status)),
      isRunning: computed(() => instanceInfo.value.status === 3),
      isStopped: computed(() => instanceInfo.value.status === 0),
      isStarting: computed(() => instanceInfo.value.status === 2),
      instanceTypeText: ref("Java server")
    };
  }
}));
vi.mock("@/stores/useLayoutContainerStore", () => ({
  useLayoutContainerStore: () => ({ containerState: state })
}));
vi.mock("@/services/apis/fileManager", () => ({ downloadAddress: () => ({ execute: api.icon }) }));
vi.mock("@/services/apis/instance", () =>
  Object.fromEntries(
    [
      ["openInstance", "start"],
      ["stopInstance", "stop"],
      ["restartInstance", "restart"],
      ["killInstance", "kill"],
      ["updateInstance", "update"]
    ].map(([name, action]) => [
      name,
      () => ({ execute: (api as any)[action], isLoading: ref(false) })
    ])
  )
);
vi.mock("@/tools/validator", () => ({ reportErrorMsg: vi.fn() }));
vi.mock("ant-design-vue", () => ({
  message: { success: api.success },
  Modal: { confirm: api.confirm }
}));
vi.mock("@/components/InstanceVersionInfo.vue", () => ({
  default: defineComponent({
    name: "VersionInfoProbe",
    props: ["instance", "daemonId"],
    setup(props) {
      api.versionMount();
      return () => {
        const versions = installedInstanceVersions(
          props.instance.config.packInfo,
          props.instance.info
        );
        return h("div", { "data-versions": props.instance.instanceUuid }, [
          h("span", { "data-installed-pack": "" }, versions.packVersion),
          h("span", { "data-installed-minecraft": "" }, versions.minecraftVersion),
          versions.liveVersion ? h("span", { "data-live-version": "" }, versions.liveVersion) : null
        ]);
      };
    }
  })
}));
vi.mock("@/components/InstanceSecondaryActions.vue", () => ({
  default: defineComponent({
    props: ["instanceId", "daemonId", "disabled", "tags"],
    emits: ["changed", "deleted"],
    setup(props) {
      return () => h("div", { "data-secondary-target": props.instanceId });
    }
  })
}));
import Shortcut from "@/widgets/instance/Shortcut.vue";
const wrappers: VueWrapper[] = [];
const pass = defineComponent({
  setup(_, { slots }) {
    return () => h("div", [slots.default?.(), slots.overlay?.()]);
  }
});
const button = defineComponent({
  props: ["disabled"],
  setup(props, { slots }) {
    return () => h("button", { disabled: props.disabled }, slots.default?.());
  }
});
const stubs = {
  "a-tooltip": pass,
  "a-typography-text": pass,
  "a-tag": pass,
  "a-button": button,
  "a-dropdown": pass,
  "a-menu": pass,
  "a-menu-item": button
};
const server = (uuid = "a", status = 3) => ({
  instanceUuid: uuid,
  status,
  config: {
    nickname: uuid,
    type: "minecraft/java",
    processType: "general",
    tag: ["custom"],
    packInfo: {
      source: "modrinth",
      loader: "fabric",
      versionName: "Pack 1.0",
      mcVersion: "1.21.1"
    },
    lastDatetime: 0
  },
  info: {
    memoryUsage: 0,
    memoryLimit: 6000,
    mcPingOnline: true,
    version: "Reported runtime version",
    currentPlayers: 0,
    maxPlayers: 20
  },
  gameEndpoint: { port: 25565, protocol: "tcp", source: "server.properties" }
});
function host(info = server(), layout: "compact" | "list" | "overview" = "compact") {
  const wrapper = mount(Shortcut, {
    props: {
      card: { meta: {} } as any,
      targetInstanceInfo: info as any,
      targetDaemonId: "node-a",
      targetNode: { ip: "localhost" } as any,
      layout,
      onClick: api.cardClick
    },
    global: { stubs }
  });
  wrappers.push(wrapper);
  return { wrapper, vm: (wrapper.vm as any).$.setupState };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await nextTick();
};
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  state.isDesignMode = false;
  api.icon.mockResolvedValue(ref());
  api.eula.mockResolvedValue(true);
});

describe.each(["compact", "list", "overview"] as const)("%s runtime presentation", (layout) => {
  it("hides stale stopped memory, ping counts and reported runtime without changing the source or installed pack", async () => {
    const stopped = server("a", 0);
    stopped.config.packInfo.mcVersion = "";
    Object.assign(stopped.info, {
      memoryUsage: 2 * 1024 ** 3,
      memoryLimit: 6 * 1024 ** 3,
      currentPlayers: 3
    });
    const originalInfo = { ...stopped.info },
      originalPack = { ...stopped.config.packInfo };
    const { wrapper } = host(stopped, layout);
    await flush();
    expect(wrapper.findAll(".server-metrics dd").map((metric) => metric.text())).toEqual([
      "—",
      "—"
    ]);
    expect(wrapper.find(".memory-meter").exists()).toBe(false);
    expect(wrapper.find("[data-live-version]").exists()).toBe(false);
    expect(wrapper.get("[data-installed-pack]").text()).toBe("Pack 1.0");
    const version = wrapper.findComponent({ name: "VersionInfoProbe" });
    expect(version.props("instance").info.mcPingOnline).toBe(false);
    expect(version.props("instance").config.packInfo).toEqual(originalPack);
    expect(stopped.info).toEqual(originalInfo);

    await wrapper.setProps({ targetInstanceInfo: { ...stopped, status: 3 } as any });
    expect(wrapper.findAll(".server-metrics dd").map((metric) => metric.text())).toEqual([
      "2.00 GiB / 6.00 GiB",
      "3 / 20"
    ]);
    expect(wrapper.get("[data-live-version]").text()).toBe("Reported runtime version");
    expect(stopped.status).toBe(0);
    expect(stopped.info).toEqual(originalInfo);
    expect(api.hook).toHaveBeenCalledOnce();
    expect(api.icon).toHaveBeenCalledOnce();
    expect(api.versionMount).toHaveBeenCalledOnce();
  });

  it("retains real running zero usage and zero player counts, then hides those readings after stop", async () => {
    const running = server();
    running.info.memoryLimit = 6 * 1024 ** 3;
    const { wrapper, vm } = host(running, layout);
    expect(wrapper.findAll(".server-metrics dd").map((metric) => metric.text())).toEqual([
      "0.00 B / 6.00 GiB",
      "0 / 20"
    ]);
    expect(vm.memoryRatio).toBe(0);
    expect(wrapper.find(".memory-meter").exists()).toBe(layout === "overview");
    if (layout === "overview")
      expect(wrapper.get(".memory-meter i").attributes("style")).toContain("width: 0%");
    await wrapper.setProps({
      targetInstanceInfo: { ...running, info: { ...running.info, maxPlayers: 0 } } as any
    });
    expect(wrapper.findAll(".server-metrics dd")[1].text()).toBe("0 / 0");
    expect(wrapper.get("[data-installed-minecraft]").text()).toBe("1.21.1");
    await wrapper.setProps({ targetInstanceInfo: { ...running, status: 0 } as any });
    expect(wrapper.findAll(".server-metrics dd").map((metric) => metric.text())).toEqual([
      "—",
      "—"
    ]);
    expect(wrapper.find(".memory-meter").exists()).toBe(false);
  });

  it("hides non-finite, negative and non-numeric usage while keeping valid player data", async () => {
    const running = server();
    running.info.memoryUsage = NaN;
    const { wrapper, vm } = host(running, layout);
    expect(wrapper.findAll(".server-metrics dd").map((metric) => metric.text())).toEqual([
      "—",
      "0 / 20"
    ]);
    expect(vm.memoryRatio).toBeUndefined();
    expect(wrapper.find(".memory-meter").exists()).toBe(false);
    await wrapper.setProps({
      targetInstanceInfo: { ...running, info: { ...running.info, memoryUsage: Infinity } } as any
    });
    expect(wrapper.findAll(".server-metrics dd")[0].text()).toBe("—");
    expect(vm.memoryRatio).toBeUndefined();
    await wrapper.setProps({
      targetInstanceInfo: { ...running, info: { ...running.info, memoryUsage: -1 } } as any
    });
    expect(wrapper.findAll(".server-metrics dd")[0].text()).toBe("—");
    expect(vm.memoryRatio).toBeUndefined();
    await wrapper.setProps({
      targetInstanceInfo: { ...running, info: { ...running.info, memoryUsage: "0" } } as any
    });
    expect(wrapper.findAll(".server-metrics dd")[0].text()).toBe("—");
    expect(wrapper.find(".memory-meter").exists()).toBe(false);
  });

  it("shows valid usage alone when the limit is non-finite, zero or negative and never draws an invalid ratio", async () => {
    const running = server();
    Object.assign(running.info, { memoryUsage: 1024 ** 3, memoryLimit: Infinity });
    const { wrapper, vm } = host(running, layout);
    expect(wrapper.findAll(".server-metrics dd")[0].text()).toBe("1.00 GiB");
    expect(vm.memoryRatio).toBeUndefined();
    expect(wrapper.find(".memory-meter").exists()).toBe(false);
    await wrapper.setProps({
      targetInstanceInfo: { ...running, info: { ...running.info, memoryLimit: NaN } } as any
    });
    expect(wrapper.findAll(".server-metrics dd")[0].text()).toBe("1.00 GiB");
    expect(vm.memoryRatio).toBeUndefined();
    await wrapper.setProps({
      targetInstanceInfo: { ...running, info: { ...running.info, memoryLimit: 0 } } as any
    });
    expect(wrapper.findAll(".server-metrics dd")[0].text()).toBe("1.00 GiB");
    expect(vm.memoryRatio).toBeUndefined();
    await wrapper.setProps({
      targetInstanceInfo: { ...running, info: { ...running.info, memoryLimit: -1 } } as any
    });
    expect(wrapper.findAll(".server-metrics dd")[0].text()).toBe("1.00 GiB");
    expect(vm.memoryRatio).toBeUndefined();
    expect(wrapper.find(".memory-meter").exists()).toBe(false);
  });

  it("rejects negative, fractional, non-finite and non-numeric player counts despite a true running ping", async () => {
    const running = server();
    running.info.currentPlayers = -1;
    const { wrapper } = host(running, layout);
    expect(wrapper.findAll(".server-metrics dd")[1].text()).toBe("—");
    await wrapper.setProps({
      targetInstanceInfo: {
        ...running,
        info: { ...running.info, currentPlayers: 0, maxPlayers: 20.5 }
      } as any
    });
    expect(wrapper.findAll(".server-metrics dd")[1].text()).toBe("—");
    await wrapper.setProps({
      targetInstanceInfo: { ...running, info: { ...running.info, currentPlayers: NaN } } as any
    });
    expect(wrapper.findAll(".server-metrics dd")[1].text()).toBe("—");
    await wrapper.setProps({
      targetInstanceInfo: {
        ...running,
        info: { ...running.info, currentPlayers: 0, maxPlayers: Infinity }
      } as any
    });
    expect(wrapper.findAll(".server-metrics dd")[1].text()).toBe("—");
    await wrapper.setProps({
      targetInstanceInfo: { ...running, info: { ...running.info, currentPlayers: "3" } } as any
    });
    expect(wrapper.findAll(".server-metrics dd")[1].text()).toBe("—");
    expect(wrapper.findAll(".server-metrics dd")[0].text()).toContain("0.00 B");
  });

  it("requires both Running and a current ping for players and live runtime versions", async () => {
    const starting = server("a", 2);
    starting.config.packInfo.mcVersion = "";
    const { wrapper } = host(starting, layout);
    expect(wrapper.findAll(".server-metrics dd")[1].text()).toBe("—");
    expect(wrapper.find("[data-live-version]").exists()).toBe(false);
    await wrapper.setProps({ targetInstanceInfo: { ...starting, status: 1 } as any });
    expect(wrapper.findAll(".server-metrics dd")[1].text()).toBe("—");
    expect(wrapper.find("[data-live-version]").exists()).toBe(false);
    await wrapper.setProps({
      targetInstanceInfo: {
        ...starting,
        status: 3,
        info: { ...starting.info, mcPingOnline: false }
      } as any
    });
    expect(wrapper.findAll(".server-metrics dd")[1].text()).toBe("—");
    expect(wrapper.find("[data-live-version]").exists()).toBe(false);
    await wrapper.setProps({ targetInstanceInfo: { ...starting, status: 3 } as any });
    expect(wrapper.findAll(".server-metrics dd")[1].text()).toBe("0 / 20");
    expect(wrapper.get("[data-live-version]").text()).toBe("Reported runtime version");
    expect(starting.info.mcPingOnline).toBe(true);
    expect(api.hook).toHaveBeenCalledOnce();
    expect(api.versionMount).toHaveBeenCalledOnce();
  });
});
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount());
});
describe("production Shortcut layouts and operations", () => {
  it("accepts immediate static-region clicks after each layout switch, keeping nested controls isolated", async () => {
    vi.useFakeTimers();
    try {
      const { wrapper } = host();
      await flush();
      const root = wrapper.element;
      const version = wrapper.get('[data-versions="a"]').element;
      for (const layout of ["list", "overview", "compact", "list"] as const) {
        await wrapper.setProps({ layout });
        for (const region of [
          "h3",
          ".server-address > .server-label",
          "[data-installed-pack]",
          ".server-metrics",
          ".server-actions"
        ]) {
          api.cardClick.mockClear();
          await wrapper.get(region).trigger("click");
          expect(api.cardClick, layout + " " + region).toHaveBeenCalledOnce();
        }
        api.cardClick.mockClear();
        api.push.mockClear();
        await wrapper.get(".console-action").trigger("click");
        expect(api.push).toHaveBeenCalledExactlyOnceWith({
          path: "/instances/terminal",
          query: { daemonId: "node-a", instanceId: "a" }
        });
        await wrapper.get("summary").trigger("click");
        await wrapper.get('[data-action="restart"]').trigger("click");
        expect(api.cardClick).not.toHaveBeenCalled();
        expect(wrapper.element).toBe(root);
        expect(wrapper.get('[data-versions="a"]').element).toBe(version);
      }
      expect(api.hook).toHaveBeenCalledOnce();
      expect(api.icon).toHaveBeenCalledOnce();
      expect(api.versionMount).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not navigate from interactive descendants, prevented clicks or cards in design mode", async () => {
    const { wrapper } = host();
    const label = wrapper.get(".server-address > .server-label").element;
    const copy = document.createElement("span");
    copy.setAttribute("role", "button");
    copy.innerHTML = "<svg><path /></svg>";
    label.appendChild(copy);
    copy.querySelector("path")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const prevented = new MouseEvent("click", { bubbles: true, cancelable: true });
    prevented.preventDefault();
    label.dispatchEvent(prevented);
    expect(api.cardClick).not.toHaveBeenCalled();
    state.isDesignMode = true;
    await nextTick();
    await wrapper.get("h3").trigger("click");
    expect(api.cardClick).not.toHaveBeenCalled();
    state.isDesignMode = false;
    await wrapper.setProps({ disabled: true });
    await wrapper.get("h3").trigger("click");
    // Batch mode still delegates selection to InstanceList; Console stays disabled.
    expect(api.cardClick).toHaveBeenCalledOnce();
    expect(wrapper.get(".console-action").attributes("disabled")).toBeDefined();
  });

  it("retains live fields, custom tags and mounted version/data hooks while switching", async () => {
    const { wrapper } = host();
    await flush();
    const root = wrapper.element;
    const version = wrapper.get('[data-versions="a"]').element;
    expect(wrapper.text()).toContain("0 / 20");
    expect(wrapper.text()).toContain("custom");
    expect(wrapper.get(".server-metrics").text()).not.toContain("—");
    for (const layout of ["list", "overview", "compact"] as const) {
      await wrapper.setProps({ layout });
      expect(wrapper.classes()).toContain("layout-" + layout);
      expect(wrapper.element).toBe(root);
      expect(wrapper.get('[data-versions="a"]').element).toBe(version);
    }
    expect(api.hook).toHaveBeenCalledOnce();
    expect(api.icon).toHaveBeenCalledOnce();
    expect(api.versionMount).toHaveBeenCalledOnce();
    expect(wrapper.find("summary").exists()).toBe(true);
    expect(wrapper.find(".console-action").exists()).toBe(true);
  });
  it("preserves native confirmation and accessibility paths for stop/restart/kill/update", async () => {
    const { wrapper, vm } = host();
    expect(vm.secondaryPower.map((item: any) => item.action)).toEqual(["restart", "kill"]);
    for (const [action, key] of [
      ["stop", "TXT_CODE_6da85509"],
      ["restart", "TXT_CODE_f6bd907d"],
      ["kill", "TXT_CODE_ec08484"]
    ]) {
      vm.requestAction(action);
      const confirm = api.confirm.mock.calls[api.confirm.mock.calls.length - 1][0];
      expect(confirm.content).toBe(key);
      expect((api as any)[action]).not.toHaveBeenCalled();
      await confirm.onOk();
      expect((api as any)[action]).toHaveBeenCalledWith({
        params: { uuid: "a", daemonId: "node-a" }
      });
    }
    const stopped = server("a", 0);
    (stopped.config as any).updateCommand = "update.sh";
    await wrapper.setProps({ targetInstanceInfo: stopped as any });
    expect(vm.secondaryPower.map((item: any) => item.action)).toEqual(["update"]);
    await vm.requestAction("update");
    expect(api.update).toHaveBeenCalledWith({
      params: { uuid: "a", daemonId: "node-a", task_name: "update" },
      data: { time: expect.any(Number) }
    });
  });
  it("does not start or refresh after rejected EULA, stale verification or stale confirmation", async () => {
    const { wrapper, vm } = host(server("a", 0));
    api.eula.mockResolvedValueOnce(false);
    await vm.requestAction("start");
    expect(api.start).not.toHaveBeenCalled();
    expect(wrapper.emitted("refreshList")).toBeUndefined();
    const eula = deferred();
    api.eula.mockReturnValue(eula.promise);
    const pending = vm.requestAction("start");
    await wrapper.setProps({ targetInstanceInfo: server("b", 0) as any });
    eula.resolve(true);
    await pending;
    expect(api.start).not.toHaveBeenCalled();
    await wrapper.setProps({ targetInstanceInfo: server("a") as any });
    vm.requestAction("stop");
    const confirm = api.confirm.mock.calls[0][0];
    await wrapper.setProps({ targetDaemonId: "node-b" });
    await confirm.onOk();
    expect(api.stop).not.toHaveBeenCalled();
    expect(wrapper.emitted("refreshList")).toBeUndefined();
  });
  it("suppresses stale power completions and disables mutation/navigation in design and batch mode", async () => {
    const stop = deferred();
    api.stop.mockReturnValue(stop.promise);
    const { wrapper, vm } = host();
    vm.requestAction("stop");
    const pending = api.confirm.mock.calls[0][0].onOk();
    wrapper.unmount();
    stop.resolve(ref(true));
    await pending;
    expect(wrapper.emitted("refreshList")).toBeUndefined();
    expect(api.success).not.toHaveBeenCalled();
    const other = host();
    await other.wrapper.setProps({ disabled: true });
    other.vm.requestAction("stop");
    other.vm.openConsole();
    expect(api.confirm).toHaveBeenCalledTimes(1);
    expect(api.push).not.toHaveBeenCalled();
    await other.wrapper.setProps({ disabled: false });
    state.isDesignMode = true;
    await nextTick();
    other.vm.openConsole();
    other.vm.requestAction("kill");
    expect(api.kill).not.toHaveBeenCalled();
    expect(api.push).not.toHaveBeenCalled();
  });
});
