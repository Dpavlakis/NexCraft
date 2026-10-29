import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick, reactive, ref } from "vue";
import Antd, { Modal, Select } from "ant-design-vue";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  info: vi.fn(),
  write: vi.fn(),
  navigate: vi.fn(),
  route: null as any,
  confirmation: null as any
}));
const labels: Record<string, string> = {
  TXT_CODE_quick_title: "Quick Settings",
  TXT_CODE_quick_save: "Save",
  TXT_CODE_quick_refresh: "Refresh",
  TXT_CODE_quick_return: "Return",
  TXT_CODE_quick_fullConfig: "Full configuration"
};
vi.mock("@/lang/i18n", () => ({ t: (key: string) => labels[key] ?? key }));
vi.mock("vue-router", () => ({ useRoute: () => api.route }));
vi.mock("@/hooks/useAppRouters", () => ({ useAppRouters: () => ({ toPage: api.navigate }) }));
vi.mock("@/services/apis/instance", () => ({
  getInstanceInfo: () => ({ execute: api.info }),
  getConfigFile: () => ({ execute: api.read }),
  updateConfigFile: () => ({ execute: api.write })
}));
import QuickSettings from "@/widgets/instance/QuickSettings.vue";
const java = () => ({
  gamemode: "survival",
  difficulty: "normal",
  pvp: false,
  "white-list": "false",
  "max-players": 20,
  "view-distance": 10,
  "simulation-distance": 10,
  motd: "Original"
});
const card = (meta = {}) =>
  ({
    id: "quick",
    type: "InstanceQuickSettings",
    title: "Quick Settings",
    meta: { instanceId: "alpha", daemonId: "node-a", type: "minecraft/java", ...meta }
  }) as any;
const settle = async () => {
  await flushPromises();
  await nextTick();
};
const pending = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
let wrappers: VueWrapper[] = [];
const create = (value = card(), embedded = false) => {
  const wrapper = mount(QuickSettings, {
    props: { card: value },
    attachTo: document.body,
    global: {
      plugins: [Antd],
      provide: { embeddedInManageModal: embedded },
      stubs: {
        CardPanel: {
          template: '<section><header><slot name="title" /></header><slot name="body" /></section>'
        }
      }
    }
  });
  wrappers.push(wrapper);
  return wrapper;
};
const button = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll("button").find((item) => item.text().trim() === text)!;
const input = (wrapper: VueWrapper, key: string) => wrapper.get(`input[id$="-${key}"]`);
const edit = async (wrapper: VueWrapper, key: string, value: string) => {
  await input(wrapper, key).setValue(value);
  await settle();
};
const save = async (wrapper: VueWrapper) => {
  await button(wrapper, "Save").trigger("click");
  await settle();
};
const confirm = async (ok = true) => {
  expect(api.confirmation).toBeTruthy();
  await api.confirmation[ok ? "onOk" : "onCancel"]();
  await settle();
};

beforeEach(() => {
  vi.clearAllMocks();
  api.confirmation = null;
  api.route = reactive({ path: "/instances/terminal", query: {} });
  api.info.mockResolvedValue(ref({ config: { type: "minecraft/java" } }));
  api.read.mockImplementation(async () => ref(java()));
  api.write.mockResolvedValue(ref(true));
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn()
  })) as any;
  const originalStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => originalStyle(el));
  vi.spyOn(Modal, "confirm").mockImplementation((options: any) => {
    api.confirmation = options;
    return { destroy: vi.fn(), update: vi.fn() };
  });
});
afterEach(async () => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers = [];
  await settle();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("native Quick Settings card", () => {
  it.each(["minecraft/java", "minecraft/bedrock/bds"])(
    "blocks old-daemon undefined reads for %s without a write",
    async (type) => {
      api.info.mockResolvedValue(ref({ config: { type } }));
      api.read.mockResolvedValueOnce(ref(undefined));
      const wrapper = create();
      await settle();
      expect(wrapper.text()).toContain("TXT_CODE_quick_error_format");
      expect(button(wrapper, "Save").attributes("disabled")).toBeDefined();
      expect(api.write).not.toHaveBeenCalled();
      await button(wrapper, "Refresh").trigger("click");
      await settle();
      expect(wrapper.findAll("label").length).toBeGreaterThan(0);
    }
  );
  it.each(["minecraft/java", "minecraft/bedrock/bds"])(
    "sends %s unrelated literal escapes unchanged using its lossless format",
    async (type) => {
      api.info.mockResolvedValue(ref({ config: { type } }));
      const wrapper = create();
      await settle();
      await edit(wrapper, "max-players", "45");
      api.read.mockResolvedValue(ref({ ...java(), "plugin-path": "C:\\users\\world" }));
      await save(wrapper);
      await confirm();
      expect(api.write).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          params: expect.objectContaining({
            type:
              type === "minecraft/java" ? "properties_lossless" : "properties_not_unicode_lossless"
          }),
          data: { ...java(), "max-players": 45, "plugin-path": "C:\\users\\world" }
        })
      );
      expect(wrapper.text()).toContain("TXT_CODE_quick_saved");
    }
  );
  it("renders seven accessible controls in their approved sections and reads the authoritative type", async () => {
    const wrapper = create(card({ type: "universal" }));
    await settle();
    expect(api.info).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        params: { uuid: "alpha", daemonId: "node-a" },
        forceRequest: true,
        signal: expect.any(AbortSignal)
      })
    );
    expect(api.read).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        params: {
          uuid: "alpha",
          daemonId: "node-a",
          fileName: "server.properties",
          type: "properties_lossless"
        },
        forceRequest: true
      })
    );
    const sections = wrapper.findAll("section[aria-labelledby]");
    expect(sections).toHaveLength(3);
    expect(sections[0].findAll("label")).toHaveLength(3);
    expect(sections[1].findAll("label")).toHaveLength(2);
    expect(sections[2].findAll("label")).toHaveLength(2);
    for (const label of wrapper.findAll("label")) {
      const control = wrapper.get(`#${label.attributes("for")}`);
      // Ant Select uses its native input's associated <label>; Switch forwards ARIA.
      expect(
        control.attributes("aria-labelledby") === label.attributes("id") ||
          Array.from((control.element as HTMLInputElement).labels ?? []).some(
            (item) => item.id === label.attributes("id")
          )
      ).toBe(true);
    }
    expect(wrapper.findAll('[role="switch"]')).toHaveLength(2);
    expect(button(wrapper, "Save").attributes("disabled")).toBeDefined();
    expect(api.write).not.toHaveBeenCalled();
  });
  it("offers Java spectator and hides absent PvP on versions that lack it", async () => {
    const file: any = java();
    delete file.pvp;
    api.read.mockResolvedValue(ref(file));
    const wrapper = create();
    await settle();
    expect(wrapper.find('[id$="-pvp"]').exists()).toBe(false);
    expect(
      wrapper
        .findAllComponents(Select)[0]
        .props("options")!
        .map((item: any) => item.value)
    ).toContain("spectator");
  });
  it("uses Bedrock UTF-8 properties reads/writes, native keys, no spectator/PvP, and fresh unknown Unicode", async () => {
    api.info.mockResolvedValue(ref({ config: { type: "minecraft/bedrock/bds" } }));
    const bds = {
      gamemode: "survival",
      difficulty: 0,
      "allow-list": false,
      "max-players": 20,
      "view-distance": 8,
      "tick-distance": 4,
      pvp: true,
      "level-name": "旧世界",
      "server-name": "旧服务器"
    };
    api.read.mockResolvedValue(ref(bds));
    const wrapper = create();
    await settle();
    expect(api.read.mock.calls[0][0].params.type).toBe("properties_not_unicode_lossless");
    expect(wrapper.find('[id$="-pvp"]').exists()).toBe(false);
    expect(wrapper.find('[id$="-simulation-distance"]').exists()).toBe(false);
    expect(wrapper.find('[id$="-tick-distance"]').exists()).toBe(true);
    expect(
      wrapper
        .findAllComponents(Select)[0]
        .props("options")!
        .map((item: any) => item.value)
    ).toEqual(["survival", "creative", "adventure"]);
    await edit(wrapper, "max-players", "55");
    await save(wrapper);
    const fresh = {
      ...bds,
      "level-name": "世界 café 🙂",
      "server-name": "新服务器 日本語",
      extension: "未知 世界"
    };
    api.read.mockResolvedValue(ref(fresh));
    await confirm();
    expect(api.read.mock.calls[1][0].params.type).toBe("properties_not_unicode_lossless");
    expect(api.write).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        params: {
          uuid: "alpha",
          daemonId: "node-a",
          fileName: "server.properties",
          type: "properties_not_unicode_lossless"
        },
        data: { ...fresh, "max-players": 55 }
      })
    );
    expect(JSON.stringify(api.write.mock.calls[0][0].data)).not.toContain("\\u");
    expect(wrapper.text()).toContain("TXT_CODE_quick_saved");
  });
  it("requires changed-save confirmation; Cancel preserves edits without a read or write", async () => {
    const wrapper = create();
    await settle();
    await save(wrapper);
    expect(api.confirmation).toBeNull();
    await edit(wrapper, "max-players", "45");
    await save(wrapper);
    expect(api.confirmation.content).toBe("TXT_CODE_config_properties_save_help");
    await confirm(false);
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(api.write).not.toHaveBeenCalled();
    expect((input(wrapper, "max-players").element as HTMLInputElement).value).toBe("45");
    expect(button(wrapper, "Save").attributes("disabled")).toBeUndefined();
  });
  it("sends unknown fresh Java properties without frontend Unicode pre-encoding", async () => {
    const wrapper = create();
    await settle();
    await edit(wrapper, "max-players", "45");
    api.read.mockResolvedValue(
      ref({ ...java(), motd: "世界", "new-key": "日本語", "server-port": 25566 })
    );
    await save(wrapper);
    await confirm();
    expect(api.write.mock.calls[0][0].data).toEqual({
      ...java(),
      "max-players": 45,
      motd: "世界",
      "new-key": "日本語",
      "server-port": 25566
    });
    expect(wrapper.text()).toContain("TXT_CODE_quick_saved");
    expect(button(wrapper, "Save").attributes("disabled")).toBeDefined();
  });
  it("reports changed-field conflicts and keeps the draft available for review", async () => {
    const wrapper = create();
    await settle();
    await edit(wrapper, "max-players", "45");
    api.read.mockResolvedValue(ref({ ...java(), "max-players": 30 }));
    await save(wrapper);
    await confirm();
    expect(api.write).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toContain("TXT_CODE_quick_error_conflict");
    expect(wrapper.get('[role="alert"]').text()).toContain("max-players");
    expect((input(wrapper, "max-players").element as HTMLInputElement).value).toBe("45");
    await button(wrapper, "Refresh").trigger("click");
    await settle();
    expect((input(wrapper, "max-players").element as HTMLInputElement).value).toBe("30");
  });
  it.each([false, undefined, "true"])(
    "does not show saved feedback without Boolean true (%s)",
    async (ack) => {
      api.write.mockResolvedValue(ref(ack));
      const wrapper = create();
      await settle();
      await edit(wrapper, "max-players", "45");
      await save(wrapper);
      await confirm();
      expect(wrapper.text()).toContain("TXT_CODE_quick_error_ack");
      expect(wrapper.text()).not.toContain("TXT_CODE_quick_saved");
      expect(button(wrapper, "Save").attributes("disabled")).toBeUndefined();
    }
  );
  it("uses inline integer errors without clamping old values or imposing a player cap", async () => {
    api.info.mockResolvedValue(ref({ config: { type: "minecraft/bedrock" } }));
    api.read.mockResolvedValue(ref({ "max-players": 0, "view-distance": 4, "tick-distance": 20 }));
    const wrapper = create();
    await settle();
    expect((input(wrapper, "tick-distance").element as HTMLInputElement).value).toBe("20");
    expect(wrapper.find('[aria-invalid="true"]').exists()).toBe(false);
    await edit(wrapper, "max-players", "99999999999999999999");
    expect(button(wrapper, "Save").attributes("disabled")).toBeUndefined();
    await edit(wrapper, "tick-distance", "13");
    expect(wrapper.text()).toContain("TXT_CODE_quick_validation_bedrockSimulation");
    expect(input(wrapper, "tick-distance").attributes("aria-invalid")).toBe("true");
    expect(button(wrapper, "Save").attributes("disabled")).toBeDefined();
    await edit(wrapper, "tick-distance", "12");
    expect(button(wrapper, "Save").attributes("disabled")).toBeUndefined();
  });
  it("shows load failure with recovery actions without escaping mount", async () => {
    api.info.mockRejectedValueOnce(new Error("offline"));
    const wrapper = create();
    await settle();
    expect(wrapper.text()).toContain("TXT_CODE_quick_error_load");
    expect(wrapper.text()).toContain("offline");
    expect(button(wrapper, "Refresh").attributes("disabled")).toBeUndefined();
    expect(button(wrapper, "Full configuration")).toBeDefined();
    await button(wrapper, "Refresh").trigger("click");
    await settle();
    expect(wrapper.findAll("label")).toHaveLength(7);
  });
  it.each(["universal", "minecraft/java/velocity", "minecraft/bedrock/nukkit"])(
    "shows useful unsupported state for real type %s",
    async (type) => {
      api.info.mockResolvedValue(ref({ config: { type } }));
      const wrapper = create();
      await settle();
      expect(wrapper.text()).toContain("TXT_CODE_quick_error_unsupported");
      expect(api.read).not.toHaveBeenCalled();
      expect(button(wrapper, "Full configuration")).toBeDefined();
    }
  );
  it("handles missing identity and an empty supported properties file", async () => {
    const wrapper = create({ ...card(), meta: {} });
    await settle();
    expect(wrapper.text()).toContain("TXT_CODE_quick_error_context");
    expect(api.info).not.toHaveBeenCalled();
    api.read.mockResolvedValue(ref({ motd: "Only a name" }));
    await wrapper.setProps({ card: card() });
    await settle();
    expect(wrapper.text()).toContain("TXT_CODE_quick_empty");
    expect(button(wrapper, "Save").attributes("disabled")).toBeDefined();
  });
  it.each(["instanceId", "daemonId", "type"])(
    "does not write after %s changes during confirmation",
    async (key) => {
      const value = reactive(card());
      const wrapper = create(value);
      await settle();
      await edit(wrapper, "max-players", "45");
      await save(wrapper);
      value.meta[key] = "other";
      await settle();
      await confirm();
      expect(api.write).not.toHaveBeenCalled();
      expect(wrapper.text()).not.toContain("TXT_CODE_quick_saved");
    }
  );
  it("does not write after route changes A→B→A during the fresh read", async () => {
    api.route.query = { instanceId: "alpha", daemonId: "node-a", type: "minecraft/java" };
    const wrapper = create({ ...card(), meta: {} });
    await settle();
    await edit(wrapper, "max-players", "45");
    const fresh = pending();
    api.read.mockReturnValueOnce(fresh.promise);
    await save(wrapper);
    api.confirmation.onOk();
    await settle();
    api.route.query.instanceId = "beta";
    await settle();
    api.route.query.instanceId = "alpha";
    await settle();
    fresh.resolve(ref(java()));
    await settle();
    expect(api.write).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain("TXT_CODE_quick_saved");
  });
  it("ignores an old acknowledgement while a new target still loads", async () => {
    const wrapper = create();
    await settle();
    await edit(wrapper, "max-players", "45");
    const ack = pending();
    api.write.mockReturnValue(ack.promise);
    await save(wrapper);
    await confirm();
    const loading = pending();
    api.read.mockReturnValueOnce(loading.promise);
    await wrapper.setProps({ card: card({ instanceId: "beta" }) });
    await settle();
    ack.resolve(ref(true));
    await settle();
    expect(wrapper.text()).toContain("TXT_CODE_quick_loading");
    expect(wrapper.text()).not.toContain("TXT_CODE_quick_saved");
    expect(button(wrapper, "Save").attributes("disabled")).toBeDefined();
    loading.resolve(ref(java()));
    await settle();
    expect((input(wrapper, "max-players").element as HTMLInputElement).value).toBe("20");
  });
  it("guards duplicate Save and Refresh while confirmation is pending", async () => {
    const wrapper = create();
    await settle();
    await edit(wrapper, "max-players", "45");
    await save(wrapper);
    expect(button(wrapper, "Save").attributes("disabled")).toBeDefined();
    expect(button(wrapper, "Refresh").attributes("disabled")).toBeDefined();
    await save(wrapper);
    expect(Modal.confirm).toHaveBeenCalledOnce();
    await confirm();
    expect(api.write).toHaveBeenCalledOnce();
  });
  it("abandons confirmation on unmount", async () => {
    const wrapper = create();
    await settle();
    await edit(wrapper, "max-players", "45");
    await save(wrapper);
    wrapper.unmount();
    wrappers = [];
    await confirm();
    expect(api.write).not.toHaveBeenCalled();
  });
  it("offers full-page Return and context-correct configuration navigation", async () => {
    api.route.path = "/instances/quickSettings";
    const wrapper = create();
    await settle();
    await button(wrapper, "Full configuration").trigger("click");
    expect(api.navigate).toHaveBeenLastCalledWith({
      path: "/instances/terminal/serverConfig",
      query: { instanceId: "alpha", daemonId: "node-a", type: "minecraft/java" }
    });
    await button(wrapper, "Return").trigger("click");
    expect(api.navigate.mock.calls[api.navigate.mock.calls.length - 1]?.[0].path).toBe(
      "/instances/terminal"
    );
    const embedded = create(card(), true);
    await settle();
    expect(embedded.get("header").text()).toBe("");
    expect(embedded.findAll("button").some((item) => item.text() === "Return")).toBe(false);
  });
});
