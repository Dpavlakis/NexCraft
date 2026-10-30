import { mount, type VueWrapper } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  kill: vi.fn(),
  update: vi.fn(),
  confirm: vi.fn(),
  push: vi.fn(),
  icon: vi.fn(),
  eula: vi.fn(),
  hook: vi.fn()
}));
const state = reactive({ isDesignMode: false });
vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/hooks/useAppRouters", () => ({ useAppRouters: () => ({ toPage: api.push }) }));
vi.mock("@/hooks/useCardTools", () => ({
  useLayoutCardTools: () => ({ getMetaOrRouteValue: () => undefined })
}));
vi.mock("@/hooks/useFileManager", () => ({ getFileConfigAddr: () => "" }));
vi.mock("@/hooks/useInstance", () => ({
  TYPE_UNIVERSAL: "universal",
  verifyEULA: api.eula,
  useInstanceInfo: (options: any) => {
    api.hook();
    const instanceInfo = options.instanceInfo;
    return {
      instanceInfo,
      statusText: computed(
        () =>
          ({ 0: "Stopped", 2: "Starting", 3: "Running" })[instanceInfo.value.status as 0 | 2 | 3] ||
          "Other"
      ),
      isRunning: computed(() => instanceInfo.value.status === 3),
      isStopped: computed(() => instanceInfo.value.status === 0),
      isStarting: computed(() => instanceInfo.value.status === 2),
      instanceTypeText: computed(() => instanceInfo.value.config.type)
    };
  }
}));
vi.mock("@/stores/useLayoutContainerStore", () => ({
  useLayoutContainerStore: () => ({ containerState: state })
}));
vi.mock("@/services/apis/fileManager", () => ({ downloadAddress: () => ({ execute: api.icon }) }));
vi.mock("@/services/apis/instance", () => ({
  openInstance: () => ({ execute: api.start, isLoading: ref(false) }),
  stopInstance: () => ({ execute: api.stop, isLoading: ref(false) }),
  restartInstance: () => ({ execute: api.restart, isLoading: ref(false) }),
  killInstance: () => ({ execute: api.kill, isLoading: ref(false) }),
  updateInstance: () => ({ execute: api.update, isLoading: ref(false) })
}));
vi.mock("@/tools/validator", () => ({ reportErrorMsg: vi.fn() }));
vi.mock("ant-design-vue", () => ({
  message: { success: vi.fn() },
  Modal: { confirm: api.confirm }
}));
vi.mock("@/components/InstanceVersionInfo.vue", () => ({
  default: defineComponent(() => () => h("span", "Installed metadata"))
}));
vi.mock("@/components/InstanceSecondaryActions.vue", () => ({
  default: defineComponent({
    props: ["instanceId", "daemonId", "nickname", "disabled", "tags"],
    emits: ["changed", "deleted"],
    setup(props) {
      return () =>
        h(
          "div",
          {
            class: "instance-secondary-actions",
            "data-instance": props.instanceId,
            "data-daemon": props.daemonId
          },
          [
            h("button", { disabled: props.disabled, "aria-label": "Tags" }, "Tags"),
            h("button", { disabled: props.disabled, "aria-label": "Delete" }, "Delete")
          ]
        );
    }
  })
}));
import Shortcut from "@/widgets/instance/Shortcut.vue";

const wrappers: VueWrapper[] = [];
const pass = defineComponent({
  setup(_, { slots }) {
    return () => h("span", slots.default?.());
  }
});
const button = defineComponent({
  props: ["disabled", "loading"],
  setup(props, { slots }) {
    return () => h("button", { type: "button", disabled: props.disabled }, slots.default?.());
  }
});
const stubs = { "a-tooltip": pass, "a-tag": pass, "a-typography-text": pass, "a-button": button };
const server = (
  status = 3,
  type = "minecraft/java/neoforge",
  updateCommand = "",
  uuid = "sample-a"
) => ({
  instanceUuid: uuid,
  status,
  config: {
    nickname: uuid,
    type,
    processType: "general",
    tag: ["Friends"],
    updateCommand,
    lastDatetime: 0,
    packInfo: type.includes("bedrock")
      ? { source: "bedrock" }
      : type.includes("minecraft")
      ? { source: "curseforge", loader: "neoforge" }
      : undefined
  },
  info: { memoryUsage: 0, memoryLimit: 1024, mcPingOnline: false },
  gameEndpoint: { port: 25565, protocol: "tcp", source: "server.properties" }
});
function host(info = server(), layout: "compact" | "list" | "overview" = "compact") {
  const wrapper = mount(Shortcut, {
    attachTo: document.body,
    props: {
      card: { meta: {} } as any,
      targetInstanceInfo: info as any,
      targetDaemonId: "node-a",
      layout
    },
    global: { stubs }
  });
  wrappers.push(wrapper);
  return wrapper;
}
const actions = (wrapper: VueWrapper) =>
  wrapper.findAll(".server-power button").map((b) => b.attributes("data-action"));
beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  state.isDesignMode = false;
  api.icon.mockResolvedValue(ref());
  api.eula.mockResolvedValue(true);
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

describe.each(["compact", "list", "overview"] as const)(
  "%s status rail and direct actions",
  (layout) => {
    it.each(["minecraft/java/neoforge", "minecraft/bedrock", "universal"])(
      "keeps native applicability and readable status for %s",
      async (type) => {
        const wrapper = host(server(3, type), layout);
        expect(wrapper.classes()).toContain("status-running");
        expect(wrapper.find(".server-icon").exists()).toBe(type.includes("minecraft"));
        expect(wrapper.get(".server-identity").classes().includes("has-server-icon")).toBe(
          type.includes("minecraft")
        );
        expect(wrapper.get(".server-status").text()).toBe("Running");
        expect(actions(wrapper)).toEqual(["stop", "restart", "kill"]);
        expect(wrapper.find(".power-menu-trigger,[role=menu],[aria-haspopup]").exists()).toBe(
          false
        );
        expect(wrapper.get(".console-action").text()).toContain("TXT_CODE_server_actions_console");
        for (const control of wrapper.findAll(".server-power button")) {
          expect(control.attributes("aria-label")).toBeTruthy();
          expect(control.attributes("title")).toBe(control.attributes("aria-label"));
          expect(control.text()).toBe(control.attributes("aria-label"));
          expect(control.find("svg").exists()).toBe(true);
        }
        expect(wrapper.get('[data-action="kill"]').classes()).toContain("terminate-action");
        const secondary = wrapper.getComponent({ name: "InstanceSecondaryActions" });
        expect(wrapper.findAll(".instance-secondary-actions")).toHaveLength(1);
        expect(wrapper.find(".server-identity .instance-secondary-actions").exists()).toBe(true);
        expect(wrapper.find(".server-actions .instance-secondary-actions").exists()).toBe(false);
        expect(secondary.props()).toMatchObject({
          instanceId: "sample-a",
          daemonId: "node-a",
          nickname: "sample-a",
          tags: ["Friends"],
          disabled: false
        });
        expect(wrapper.get(".instance-secondary-actions").text()).toContain("Tags");
        expect(wrapper.get(".instance-secondary-actions").text()).toContain("Delete");
        await wrapper.setProps({ targetInstanceInfo: server(2, type) as any });
        expect(wrapper.classes()).toContain("status-starting");
        expect(wrapper.classes()).not.toContain("status-running");
        expect(actions(wrapper)).toEqual(["kill"]);
        expect(wrapper.get(".server-status").text()).toBe("Starting");
        await wrapper.setProps({ targetInstanceInfo: server(0, type) as any });
        expect(wrapper.classes()).not.toContain("status-running");
        expect(wrapper.classes()).not.toContain("status-starting");
        expect(actions(wrapper)).toEqual(["start"]);
        expect(wrapper.get('[data-action="start"]').text()).toBe("TXT_CODE_57245e94");
        expect(wrapper.get(".server-status").text()).toBe("Stopped");
        await wrapper.setProps({ targetInstanceInfo: server(0, type, "update.sh") as any });
        expect(actions(wrapper)).toEqual(["start", "update"]);
        expect(wrapper.get('[data-action="update"]').text()).toBe("TXT_CODE_40ca4f2");
        await wrapper.setProps({ targetInstanceInfo: server(1, type, "update.sh") as any });
        expect(wrapper.classes()).not.toContain("status-running");
        expect(wrapper.classes()).not.toContain("status-starting");
        expect(actions(wrapper)).toEqual(["kill"]);
        expect(api.hook).toHaveBeenCalledOnce();
        expect(api.icon).toHaveBeenCalledTimes(type.includes("minecraft") ? 1 : 0);
        for (const action of [api.start, api.stop, api.restart, api.kill, api.update])
          expect(action).not.toHaveBeenCalled();
      }
    );

    it("keeps card selection separate from nested controls, confirmations, and console navigation", async () => {
      const wrapper = host();
      await wrapper.setProps({ layout });
      await wrapper.get("h3").trigger("click");
      expect(wrapper.emitted("click")).toHaveLength(1);
      await wrapper.get('[data-action="restart"] svg').trigger("click");
      expect(wrapper.emitted("click")).toHaveLength(1);
      expect(api.push).not.toHaveBeenCalled();
      expect(api.confirm).toHaveBeenCalledOnce();
      expect(api.confirm.mock.calls[0][0].content).toBe("TXT_CODE_f6bd907d");
      expect(api.restart).not.toHaveBeenCalled();
      await api.confirm.mock.calls[0][0].onOk();
      expect(api.restart).toHaveBeenCalledExactlyOnceWith({
        params: { uuid: "sample-a", daemonId: "node-a" }
      });
      await wrapper.get(".console-action svg").trigger("click");
      expect(api.push).toHaveBeenCalledExactlyOnceWith({
        path: "/instances/terminal",
        query: { daemonId: "node-a", instanceId: "sample-a" }
      });
      for (const button of wrapper.findAll(".server-identity .instance-secondary-actions button"))
        await button.trigger("click");
      await wrapper.get("summary").trigger("click");
      expect(wrapper.emitted("click")).toHaveLength(1);
    });
  }
);

describe("direct native action guards", () => {
  it("retains the single header action instance, target props and refresh events across layouts", async () => {
    const wrapper = host();
    const secondary = wrapper.getComponent({ name: "InstanceSecondaryActions" });
    const root = secondary.element;
    for (const layout of ["list", "overview", "compact"] as const) {
      await wrapper.setProps({ layout });
      expect(wrapper.get(".server-identity .instance-secondary-actions").element).toBe(root);
      expect(wrapper.findAll(".instance-secondary-actions")).toHaveLength(1);
    }
    secondary.vm.$emit("changed");
    secondary.vm.$emit("deleted");
    expect(wrapper.emitted("refreshList")).toHaveLength(2);
    await wrapper.setProps({
      targetInstanceInfo: server(0, "universal", "", "sample-b") as any,
      targetDaemonId: "node-b"
    });
    expect(secondary.element).toBe(root);
    expect(secondary.props()).toMatchObject({
      instanceId: "sample-b",
      daemonId: "node-b",
      nickname: "sample-b"
    });
    await wrapper.setProps({ disabled: true });
    secondary.vm.$emit("changed");
    secondary.vm.$emit("deleted");
    expect(wrapper.emitted("refreshList")).toHaveLength(2);
    expect(api.hook).toHaveBeenCalledOnce();
  });

  it.each([
    ["stop", "TXT_CODE_6da85509"],
    ["restart", "TXT_CODE_f6bd907d"],
    ["kill", "TXT_CODE_ec08484"]
  ] as const)(
    "retains %s confirmation and ignores a stale captured target",
    async (action, message) => {
      const wrapper = host();
      await wrapper.get(`[data-action="${action}"]`).trigger("click");
      const confirmation = api.confirm.mock.calls[0][0];
      expect(confirmation.content).toBe(message);
      expect(api[action]).not.toHaveBeenCalled();
      await wrapper.setProps({
        targetInstanceInfo: server(3, "minecraft/bedrock", "", "sample-b") as any
      });
      await confirmation.onOk();
      expect(api[action]).not.toHaveBeenCalled();
      expect(wrapper.emitted("refreshList")).toBeUndefined();
      await wrapper.get(`[data-action="${action}"]`).trigger("click");
      await api.confirm.mock.calls[1][0].onOk();
      expect(api[action]).toHaveBeenCalledExactlyOnceWith({
        params: { uuid: "sample-b", daemonId: "node-a" }
      });
    }
  );

  it("executes configured update through its existing native request without a power confirmation", async () => {
    const wrapper = host(server(0, "minecraft/bedrock", "update.sh"));
    await wrapper.get('[data-action="update"]').trigger("click");
    expect(api.update).toHaveBeenCalledExactlyOnceWith({
      params: { uuid: "sample-a", daemonId: "node-a", task_name: "update" },
      data: { time: expect.any(Number) }
    });
    expect(api.confirm).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
    expect(api.push).not.toHaveBeenCalled();
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  it("keeps Start behind its existing EULA check and respects batch/design-mode disablement", async () => {
    const wrapper = host(server(0));
    api.eula.mockResolvedValueOnce(false);
    await wrapper.get('[data-action="start"]').trigger("click");
    expect(api.eula).toHaveBeenCalledExactlyOnceWith("sample-a", "node-a");
    expect(api.start).not.toHaveBeenCalled();
    await wrapper.setProps({ disabled: true });
    expect(wrapper.findAll("button").every((b) => b.attributes("disabled") !== undefined)).toBe(
      true
    );
    await wrapper.get("h3").trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
    await wrapper.setProps({ disabled: false });
    state.isDesignMode = true;
    await nextTick();
    expect(wrapper.findAll("button").every((b) => b.attributes("disabled") !== undefined)).toBe(
      true
    );
    await wrapper.get("h3").trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
    expect(api.confirm).not.toHaveBeenCalled();
    expect(api.push).not.toHaveBeenCalled();
  });
});
