import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, nextTick, reactive, ref } from "vue";
import Antd, { message, Modal } from "ant-design-vue";
import labels from "../../../languages/en_US.json";
import { t } from "@/lang/i18n";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  instance: vi.fn(),
  write: vi.fn(),
  list: vi.fn(),
  navigate: vi.fn(),
  raw: vi.fn(),
  error: vi.fn(),
  route: null as any,
  phone: null as any,
  confirm: null as any
}));
vi.mock("@/lang/i18n", () => ({
  t: (key: string) => (labels as Record<string, string>)[key] || key
}));
vi.mock("vue-router", () => ({ useRoute: () => api.route }));
vi.mock("@/hooks/useAppRouters", () => ({ useAppRouters: () => ({ toPage: api.navigate }) }));
vi.mock("@/hooks/useScreen", () => ({ useScreen: () => ({ isPhone: api.phone }) }));
vi.mock("@/tools/validator", () => ({ reportErrorMsg: api.error }));
vi.mock("@/services/apis/instance", () => ({
  getInstanceInfo: () => ({ execute: api.instance }),
  getConfigFile: () => {
    const state = ref({});
    return {
      state,
      isLoading: ref(false),
      isReady: ref(true),
      execute: async (request: any) => {
        const response = await api.read(request);
        state.value = response.value;
        return state;
      }
    };
  },
  updateConfigFile: () => ({ state: ref(true), isLoading: ref(false), execute: api.write }),
  getConfigFileList: () => ({ state: ref([]), isLoading: ref(false), execute: api.list })
}));
vi.mock("@/widgets/instance/dialogs/FileEditor.vue", () => ({
  default: defineComponent({
    setup(_, { expose }) {
      expose({ openDialog: api.raw });
    },
    template: "<div />"
  })
}));
import Overview from "@/widgets/instance/ServerConfigOverview.vue";
import Structured from "@/widgets/instance/ServerConfigFile.vue";

let wrappers: VueWrapper[] = [];
const card = (type = "minecraft/java", meta: Record<string, string> = {}) =>
  ({
    id: "config",
    title: "Server configuration",
    meta: { instanceId: "alpha", daemonId: "node-a", type, ...meta }
  }) as any;
const settle = async () => {
  await flushPromises();
  await nextTick();
};
const deferred = () => {
  const resolve = vi.fn();
  const promise = new Promise<any>((finish) => {
    resolve.mockImplementation(finish);
  });
  return { promise, resolve };
};
const create = (component: any = Overview, value = card(), embedded = false) => {
  const wrapper = mount(component, {
    props: { card: value },
    attachTo: document.body,
    global: {
      plugins: [Antd],
      provide: { embeddedInManageModal: embedded },
      stubs: {
        CardPanel: { template: '<section><slot name="body" /></section>' },
        BetweenMenus: { template: '<div><slot name="left" /><slot name="right" /></div>' }
      }
    }
  });
  wrappers.push(wrapper);
  return wrapper;
};
const click = async (wrapper: VueWrapper, key: keyof typeof labels) => {
  const button = wrapper.findAll("button").find((item) => item.text().trim() === labels[key]);
  expect(button, labels[key]).toBeDefined();
  await button!.trigger("click");
  await settle();
};
beforeEach(() => {
  vi.clearAllMocks();
  api.route = reactive({ query: {} });
  api.phone = ref(false);
  api.read.mockImplementation(async () => ref({ pvp: false, motd: "A", "server-port": 25565 }));
  api.instance.mockResolvedValue(
    ref({ instanceUuid: "alpha", config: { type: "minecraft/bedrock/bds" } })
  );
  api.write.mockResolvedValue(ref(true));
  api.list.mockResolvedValue(ref([{ file: "config.json" }]));
  api.raw.mockResolvedValue(undefined);
  api.confirm = null;
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn()
  })) as any;
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => original(el));
  vi.spyOn(message, "success").mockImplementation(() => undefined as any);
  vi.spyOn(Modal, "confirm").mockImplementation((options: any) => {
    api.confirm = options;
    return { destroy: vi.fn(), update: vi.fn() };
  });
});
afterEach(async () => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers = [];
  Modal.destroyAll();
  await settle();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("direct server configuration", () => {
  it.each([
    ["json", "config.json", ["first", "second"]],
    ["json", "config.json", "legacy JSON string"],
    ["yml", "plugin.yml", ["alpha", "beta"]],
    ["txt", "settings.txt", "legacy plain text"]
  ])(
    "keeps loaded %s %s non-properties shapes and saves them unchanged",
    async (format, filename, value) => {
      api.read.mockResolvedValueOnce(ref(value));
      const wrapper = create(
        Structured,
        card("hytale", {
          configName: "legacy/config",
          configPath: String(filename),
          extName: String(format)
        })
      );
      await settle();
      const saveButton = wrapper
        .findAll("button")
        .find((item) => item.text() === labels.TXT_CODE_abfe9512)!;
      expect(saveButton.attributes("disabled")).toBeUndefined();
      expect(wrapper.text()).not.toContain(t("TXT_CODE_quick_error_format"));
      await click(wrapper, "TXT_CODE_abfe9512");
      expect(api.write).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          params: expect.objectContaining({ fileName: filename, type: format }),
          data: value
        })
      );
    }
  );
  it.each(["json", "yml", "txt"])(
    "blocks undefined successful %s reads without an empty write",
    async (format) => {
      api.read.mockResolvedValueOnce(ref(undefined));
      const wrapper = create(
        Structured,
        card("hytale", {
          configName: "legacy/config",
          configPath: `config.${format}`,
          extName: format
        })
      );
      await settle();
      expect(wrapper.text()).toContain(t("TXT_CODE_quick_error_format"));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
      await settle();
      expect(api.write).not.toHaveBeenCalled();
    }
  );
  it.each(["minecraft/java", "minecraft/bedrock/bds"])(
    "blocks an older daemon's undefined %s response and recovers only after a valid Refresh",
    async (type) => {
      api.read.mockResolvedValueOnce(ref(undefined));
      const wrapper = create(Overview, card(type));
      await settle();
      expect(wrapper.text()).toContain(t("TXT_CODE_quick_error_format"));
      const saveButton = wrapper
        .findAll("button")
        .find((item) => item.text() === labels.TXT_CODE_abfe9512)!;
      expect(saveButton.attributes("disabled")).toBeDefined();
      expect(wrapper.find('[role="switch"]').exists()).toBe(false);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
      await settle();
      expect(api.write).not.toHaveBeenCalled();
      expect(Modal.confirm).not.toHaveBeenCalled();
      await click(wrapper, "TXT_CODE_b76d94e0");
      expect(wrapper.find('[role="switch"]').exists()).toBe(true);
      expect(saveButton.attributes("disabled")).toBeUndefined();
    }
  );
  it.each([null, [], "", "unparsed text", false, 0])(
    "never enables parsed Save for malformed successful read %s",
    async (value) => {
      api.read.mockResolvedValueOnce(ref(value));
      const wrapper = create();
      await settle();
      expect(wrapper.text()).toContain(t("TXT_CODE_quick_error_format"));
      await click(wrapper, "TXT_CODE_abfe9512");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
      await settle();
      expect(api.write).not.toHaveBeenCalled();
      expect(Modal.confirm).not.toHaveBeenCalled();
    }
  );
  it("disables an existing loaded editor while Refresh is pending and after an undefined response", async () => {
    const wrapper = create();
    await settle();
    const response = deferred();
    api.read.mockReturnValueOnce(response.promise);
    await click(wrapper, "TXT_CODE_b76d94e0");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    await settle();
    expect(api.write).not.toHaveBeenCalled();
    expect(Modal.confirm).not.toHaveBeenCalled();
    response.resolve(ref(undefined));
    await settle();
    expect(wrapper.text()).toContain(t("TXT_CODE_quick_error_format"));
    expect(wrapper.find('[role="switch"]').exists()).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    await settle();
    expect(api.write).not.toHaveBeenCalled();
  });
  it.each([
    ["minecraft/java", "properties_lossless"],
    ["minecraft/bedrock/bds", "properties_not_unicode_lossless"],
    ["minecraft/java", "properties"],
    ["minecraft/bedrock/bds", "properties_not_unicode"]
  ])("keeps %s explicit %s bookmarks and their encoding contract", async (type, format) => {
    const file = { motd: "世界 🙂", "plugin-path": "C:\\users\\world", literal: "\\u4e16" };
    api.read.mockResolvedValueOnce(ref(file));
    const wrapper = create(
      Structured,
      card(type, {
        configName: "common/server.properties",
        configPath: "server.properties",
        extName: format
      })
    );
    await settle();
    await wrapper.findAll("input")[0].setValue("世界二 🙂");
    await click(wrapper, "TXT_CODE_abfe9512");
    api.confirm.onOk();
    await settle();
    expect(api.read.mock.calls[0][0].params.type).toBe(format);
    expect(api.write.mock.calls[0][0]).toMatchObject({
      params: { type: format },
      data: {
        motd: format === "properties" ? "\\u4e16\\u754c\\u4e8c 🙂" : "世界二 🙂",
        "plugin-path": file["plugin-path"],
        literal: file.literal
      }
    });
  });
  it.each([
    ["minecraft/java", "common/server.properties", "properties_lossless"],
    ["minecraft/java/paper", "common/server.properties", "properties_lossless"],
    ["minecraft/bedrock", "bds/server.properties", "properties_not_unicode_lossless"],
    ["minecraft/bedrock/bds", "bds/server.properties", "properties_not_unicode_lossless"]
  ])(
    "opens %s using its existing catalog definition without a file-list request",
    async (type, configName, parser) => {
      const wrapper = create(Overview, card(type));
      await settle();
      expect(api.list).not.toHaveBeenCalled();
      expect(api.instance).not.toHaveBeenCalled();
      expect(api.read).toHaveBeenCalledExactlyOnceWith({
        params: {
          uuid: "alpha",
          daemonId: "node-a",
          fileName: "server.properties",
          type: parser
        }
      });
      const editor = wrapper.getComponent(Structured);
      expect(editor.props("card").meta.configName).toBe(configName);
      expect(editor.props("card").meta.extName).toBe(parser);
      expect(wrapper.find(".config-file-row").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("[General]");
      expect(wrapper.text()).not.toContain("eula.txt");
      expect(wrapper.find('[role="switch"][aria-label="pvp"]').exists()).toBe(true);
      expect(api.write).not.toHaveBeenCalled();
    }
  );

  it("resolves BDS from actual instance data when a full-page card and route carry only IDs", async () => {
    api.route.query = { instanceId: "alpha", daemonId: "node-a" };
    const wrapper = create(Overview, {
      id: "route",
      title: "Server configuration",
      meta: {}
    } as any);
    await settle();
    expect(api.instance).toHaveBeenCalledExactlyOnceWith({
      params: { uuid: "alpha", daemonId: "node-a" }
    });
    expect(api.list).not.toHaveBeenCalled();
    expect(wrapper.getComponent(Structured).props("card").meta).toMatchObject({
      type: "minecraft/bedrock/bds",
      configName: "bds/server.properties",
      extName: "properties_not_unicode_lossless"
    });
    expect(api.read).toHaveBeenCalledExactlyOnceWith({
      params: {
        uuid: "alpha",
        daemonId: "node-a",
        fileName: "server.properties",
        type: "properties_not_unicode_lossless"
      }
    });
    await click(wrapper, "TXT_CODE_backup_to_console");
    expect(api.navigate).toHaveBeenCalledWith({
      path: "/instances/terminal",
      query: { instanceId: "alpha", daemonId: "node-a", type: "minecraft/bedrock/bds" }
    });
  });

  it("ignores an old edition lookup after a replacement target has opened its BDS editor", async () => {
    const pending = deferred();
    api.instance.mockReturnValueOnce(pending.promise);
    const wrapper = create(Overview, card(""));
    await settle();
    expect(api.read).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
    api.instance.mockResolvedValueOnce(
      ref({ instanceUuid: "beta", config: { type: "minecraft/bedrock/bds" } })
    );
    await wrapper.setProps({ card: card("", { instanceId: "beta", daemonId: "node-b" }) });
    await settle();
    pending.resolve(ref({ instanceUuid: "alpha", config: { type: "minecraft/java" } }));
    await settle();
    expect(wrapper.getComponent(Structured).props("card").meta).toMatchObject({
      instanceId: "beta",
      daemonId: "node-b",
      configName: "bds/server.properties",
      extName: "properties_not_unicode_lossless"
    });
    expect(api.read).toHaveBeenCalledExactlyOnceWith({
      params: {
        uuid: "beta",
        daemonId: "node-b",
        fileName: "server.properties",
        type: "properties_not_unicode_lossless"
      }
    });
    expect(api.error).not.toHaveBeenCalled();
  });

  it("ignores an edition lookup that finishes after unmount", async () => {
    const pending = deferred();
    api.instance.mockReturnValueOnce(pending.promise);
    const wrapper = create(Overview, card(""));
    await settle();
    wrapper.unmount();
    wrappers = [];
    pending.resolve(ref({ instanceUuid: "alpha", config: { type: "minecraft/bedrock/bds" } }));
    await settle();
    expect(api.read).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
    expect(api.error).not.toHaveBeenCalled();
  });

  it("sends Bedrock world names as UTF-8 through the non-Unicode properties formatter", async () => {
    api.read.mockResolvedValueOnce(ref({ "level-name": "测试世界" }));
    const wrapper = create(Overview, card("minecraft/bedrock/bds"));
    await settle();
    await wrapper.get("input").setValue("测试世界二");
    await click(wrapper, "TXT_CODE_abfe9512");
    api.confirm.onOk();
    await settle();
    expect(api.write).toHaveBeenCalledExactlyOnceWith({
      params: {
        uuid: "alpha",
        daemonId: "node-a",
        fileName: "server.properties",
        type: "properties_not_unicode_lossless"
      },
      data: { "level-name": "测试世界二" }
    });
  });

  it.each([false, true])("returns to the instance Terminal on phone=%s", async (phone) => {
    api.phone.value = phone;
    const wrapper = create();
    await settle();
    await click(wrapper, "TXT_CODE_backup_to_console");
    expect(api.navigate).toHaveBeenCalledWith({
      path: "/instances/terminal",
      query: { instanceId: "alpha", daemonId: "node-a", type: "minecraft/java" }
    });
  });

  it("keeps the Manage popup inline with no redundant title or Return", async () => {
    const wrapper = create(Overview, card("minecraft/bedrock"), true);
    await settle();
    expect(wrapper.find("h4").exists()).toBe(false);
    expect(
      wrapper
        .findAll("button")
        .some((button) => button.text() === labels.TXT_CODE_backup_to_console)
    ).toBe(false);
    expect(wrapper.find('[role="switch"]').exists()).toBe(true);
    await click(wrapper, "TXT_CODE_b76d94e0");
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(api.navigate).not.toHaveBeenCalled();
  });

  it("preserves changed-save cancellation, payload types and explicit acceptance", async () => {
    const wrapper = create();
    await settle();
    await wrapper.get('[role="switch"][aria-label="pvp"]').trigger("click");
    await click(wrapper, "TXT_CODE_abfe9512");
    expect(api.confirm.content).toContain("next time the server starts");
    api.confirm.onCancel();
    await settle();
    expect(api.write).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
    await click(wrapper, "TXT_CODE_abfe9512");
    api.confirm.onOk();
    await settle();
    expect(api.write).toHaveBeenCalledExactlyOnceWith({
      params: {
        uuid: "alpha",
        daemonId: "node-a",
        fileName: "server.properties",
        type: "properties_lossless"
      },
      data: { pvp: true, motd: "A", "server-port": 25565 }
    });
  });

  it("opens native raw access at the real filename and refreshes parsed data on close", async () => {
    const wrapper = create();
    await settle();
    await click(wrapper, "TXT_CODE_1f61e5a3");
    expect(api.raw).toHaveBeenCalledWith("server.properties", "common/server.properties");
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(api.write).not.toHaveBeenCalled();
  });

  it("keeps legacy other-file routes functional and returns them to Terminal", async () => {
    const wrapper = create(
      Structured,
      card("minecraft/java", {
        configName: "common/eula.txt",
        configPath: "eula.txt",
        extName: "properties"
      })
    );
    await settle();
    expect(api.read.mock.calls[0][0].params.fileName).toBe("eula.txt");
    await click(wrapper, "TXT_CODE_backup_to_console");
    expect(api.navigate.mock.calls[0][0].path).toBe("/instances/terminal");
    expect(api.write).not.toHaveBeenCalled();
  });

  it("preserves the native file-row fallback for a type without server.properties", async () => {
    const wrapper = create(Overview, card("hytale"));
    await settle();
    expect(api.list).toHaveBeenCalledExactlyOnceWith({
      params: { uuid: "alpha", daemonId: "node-a" },
      data: { files: ["config.json"] }
    });
    const row = wrapper.get<HTMLButtonElement>("button.config-file-row");
    expect(row.element.tabIndex).toBe(0);
    expect(row.findAll("button, a, input")).toHaveLength(0);
    await row.trigger("click");
    expect(api.navigate).toHaveBeenCalledWith({
      path: "/instances/terminal/serverConfig/fileEdit",
      query: {
        instanceId: "alpha",
        daemonId: "node-a",
        type: "hytale",
        configName: "hytale/config.json",
        configPath: "config.json",
        extName: "json"
      }
    });
  });

  it("remounts the edition editor and rejects the old pending save when context changes", async () => {
    const wrapper = create();
    await settle();
    await wrapper.get('[role="switch"][aria-label="pvp"]').trigger("click");
    await click(wrapper, "TXT_CODE_abfe9512");
    const oldConfirm = api.confirm;
    await wrapper.setProps({
      card: card("minecraft/bedrock", { instanceId: "beta", daemonId: "node-b" })
    });
    await settle();
    expect(wrapper.getComponent(Structured).props("card").meta.configName).toBe(
      "bds/server.properties"
    );
    oldConfirm.onOk();
    await settle();
    expect(api.write).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
    expect(api.read.mock.lastCall![0].params).toMatchObject({ uuid: "beta", daemonId: "node-b" });
  });

  it("rejects a stale confirmation even after route context changes away and back", async () => {
    api.route.query = {
      ...card().meta,
      configName: "common/server.properties",
      configPath: "server.properties",
      extName: "properties"
    };
    const wrapper = create(Structured, { id: "route", title: "Configuration", meta: {} } as any);
    await settle();
    await wrapper.get('[role="switch"][aria-label="pvp"]').trigger("click");
    await click(wrapper, "TXT_CODE_abfe9512");
    api.route.query.instanceId = "beta";
    await nextTick();
    api.route.query.instanceId = "alpha";
    await nextTick();
    api.confirm.onOk();
    await settle();
    expect(api.write).not.toHaveBeenCalled();
    expect(message.success).not.toHaveBeenCalled();
  });

  it("ignores a fallback list response after the target has become direct Bedrock configuration", async () => {
    let complete!: (value: any) => void;
    api.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const wrapper = create(Overview, card("hytale"));
    await settle();
    await wrapper.setProps({ card: card("minecraft/bedrock", { instanceId: "beta" }) });
    await settle();
    complete(ref([{ file: "config.json" }]));
    await settle();
    expect(wrapper.find(".config-file-row").exists()).toBe(false);
    expect(wrapper.getComponent(Structured).props("card").meta.instanceId).toBe("beta");
    expect(api.error).not.toHaveBeenCalled();
  });

  it("rejects a pending save cleanly when navigation removes route context", async () => {
    api.route.query = {
      ...card().meta,
      configName: "common/server.properties",
      configPath: "server.properties",
      extName: "properties"
    };
    const wrapper = create(Structured, { id: "route", title: "Configuration", meta: {} } as any);
    await settle();
    await wrapper.get('[role="switch"][aria-label="pvp"]').trigger("click");
    await click(wrapper, "TXT_CODE_abfe9512");
    expect(() => {
      api.route.query = {};
    }).not.toThrow();
    api.confirm.onOk();
    await settle();
    expect(api.write).not.toHaveBeenCalled();
  });
});
