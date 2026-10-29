import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMWrapper, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, nextTick, reactive, ref } from "vue";
import Antd, { message, Modal } from "ant-design-vue";
import labels from "../../../../languages/en_US.json";

const fixture = vi.hoisted(() => ({
  config: null as any,
  text: null as any,
  confirm: null as any,
  read: vi.fn(),
  write: vi.fn(),
  raw: vi.fn(),
  navigate: vi.fn(),
  error: vi.fn(),
  select: vi.fn(),
  instance: vi.fn(),
  list: vi.fn(),
  add: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  addDialog: vi.fn(),
  downloadDialog: vi.fn()
}));
vi.mock("@/lang/i18n", () => ({
  t: (key: string, args: Record<string, unknown> = {}) => {
    let text = (labels as Record<string, string>)[key] ?? key;
    for (const [k, v] of Object.entries(args)) text = text.replace("{" + k + "}", String(v));
    return text;
  }
}));
vi.mock("@/hooks/useScreen", () => ({ useScreen: () => ({ isPhone: ref(false) }) }));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }) }));
vi.mock("@/hooks/useCardTools", () => ({
  useLayoutCardTools: (card: any) => ({ getMetaOrRouteValue: (key: string) => card.meta[key] })
}));
vi.mock("@/hooks/useAppRouters", () => ({ useAppRouters: () => ({ toPage: fixture.navigate }) }));
vi.mock("@/tools/validator", () => ({ reportErrorMsg: fixture.error }));
vi.mock("@/hooks/useInstance", () => ({
  getInstanceConfigByType: () => [
    {
      path: "server.properties",
      fileName: "server.properties",
      info: "Configure your Minecraft server properties.",
      redirect: "common/server.properties",
      type: "properties"
    }
  ]
}));
vi.mock("@/services/apis/instance", () => ({
  getInstanceInfo: () => ({ execute: fixture.instance }),
  getConfigFile: () => ({
    execute: fixture.read,
    state: fixture.config,
    isLoading: ref(false),
    isReady: ref(true)
  }),
  updateConfigFile: () => ({ execute: fixture.write, state: ref(true), isLoading: ref(false) }),
  getConfigFileList: () => ({
    execute: vi.fn(),
    state: ref([{ file: "server.properties" }]),
    isLoading: ref(false)
  })
}));
vi.mock("@/services/apis/fileManager", () => ({
  fileContent: () => ({ execute: fixture.raw, state: fixture.text, isLoading: ref(false) })
}));
vi.mock("@/services/apis/javaManager", () => ({
  getJavaList: () => ({ execute: fixture.list }),
  usingJava: () => ({ execute: fixture.select }),
  addJava: () => ({ execute: fixture.add }),
  downloadJava: () => ({ execute: fixture.download }),
  deleteJava: () => ({ execute: fixture.remove })
}));
vi.mock("@/components/fc", () => ({
  useAddJavaDialog: fixture.addDialog,
  useDownloadJavaDialog: fixture.downloadDialog
}));
vi.mock("@/components/Editor.vue", () => ({
  default: defineComponent({
    props: ["text"],
    emits: ["update:text"],
    template:
      '<textarea aria-label="Raw file" :value="text" @input="$emit(\'update:text\', $event.target.value)" />'
  })
}));
import ConfigEditor from "../InstanceConfigEditor.vue";
import LineOption from "../LineOption.vue";
import Overview from "../../widgets/instance/ServerConfigOverview.vue";
import Structured from "../../widgets/instance/ServerConfigFile.vue";
import Raw from "../../widgets/instance/dialogs/FileEditor.vue";
import Java from "../../widgets/instance/dialogs/JavaManager.vue";
import { confirmServerPropertiesSave } from "@/tools/confirmServerPropertiesSave";

let wrappers: VueWrapper[] = [];
const settle = async () => {
  await flushPromises();
  await nextTick();
};
const page = () => new DOMWrapper(document.body);
const text = (key: keyof typeof labels) => labels[key];
const card = (path = "server.properties") =>
  ({
    id: "test",
    title: "Configuration",
    meta: {
      instanceId: "server",
      daemonId: "node",
      type: "minecraft/java",
      configName: "common/server.properties",
      configPath: path,
      extName: "properties"
    }
  }) as any;
const panel = { template: '<section><slot name="body" /></section>' };
const create = (component: any, props: any = {}, options: any = {}) => {
  const wrapper = mount(component, {
    props,
    attachTo: document.body,
    global: {
      plugins: [Antd],
      stubs: {
        CardPanel: panel,
        BetweenMenus: { template: '<div><slot name="left"/><slot name="right"/></div>' }
      },
      ...options
    }
  });
  wrappers.push(wrapper);
  return wrapper;
};
const click = async (label: string) => {
  const button = page()
    .findAll("button")
    .find((b) => b.text().trim() === label);
  if (!button) throw Error("Missing button: " + label);
  await button.trigger("click");
  await settle();
};
const keyboardSave = async () => {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true })
  );
  await settle();
};
const field = (wrapper: VueWrapper, key: string) =>
  wrapper.findAllComponents(LineOption).find((w) => w.props("optionKey") === key)!;
const runtime = (id: string, usage: string[] = [], downloading = false) => ({
  info: { fullname: id, installTime: 0, downloading },
  path: id,
  usingInstances: usage
});

beforeEach(() => {
  vi.clearAllMocks();
  fixture.confirm = null;
  fixture.config = ref({
    pvp: false,
    motd: "Welcome",
    "max-players": 20,
    empty: "",
    literal: "false",
    long: "<__long__>9007199254740993",
    float: "<__float__>1.25"
  });
  fixture.text = ref("pvp=false\n");
  fixture.read.mockResolvedValue(fixture.config);
  fixture.write.mockResolvedValue(ref(true));
  fixture.raw.mockResolvedValue(fixture.text);
  fixture.list.mockResolvedValue(ref([runtime("A", ["server"]), runtime("B")]));
  fixture.instance.mockResolvedValue(
    ref({
      config: {
        java: { id: "B" },
        startCommand: '{mcsm_java} -jar "server files/server.jar"',
        nickname: "Remote name",
        stopCommand: "remote-stop",
        eventTask: { autoStart: false }
      }
    })
  );
  for (const fn of [fixture.select, fixture.add, fixture.download, fixture.remove])
    fn.mockResolvedValue(ref(true));
  fixture.addDialog.mockResolvedValue(undefined);
  fixture.downloadDialog.mockResolvedValue(undefined);
  window.matchMedia = vi
    .fn()
    .mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }));
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => original(el));
  vi.spyOn(message, "success").mockImplementation(() => undefined as any);
  vi.spyOn(message, "error").mockImplementation(() => undefined as any);
  vi.spyOn(Modal, "confirm").mockImplementation((options: any) => {
    fixture.confirm = options;
    return { destroy: vi.fn(), update: vi.fn() };
  });
});
afterEach(async () => {
  for (const wrapper of wrappers) wrapper.unmount();
  wrappers = [];
  Modal.destroyAll();
  await settle();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("configuration interactions", () => {
  it("opts into labeled switches and preserves boolean/text/number/empty/literal/magic payloads", async () => {
    const wrapper = create(ConfigEditor, {
      config: fixture.config.value,
      configName: "common/server.properties"
    });
    await settle();
    const toggle = wrapper.get('button[role="switch"][aria-label="pvp"]');
    expect(toggle.attributes("aria-checked")).toBe("false");
    expect(field(wrapper, "pvp").text()).toContain("No");
    await toggle.trigger("click");
    expect(fixture.config.value.pvp).toBe(true);
    expect(field(wrapper, "pvp").text()).toContain("Yes");
    await field(wrapper, "motd").get("input").setValue("Hello");
    await field(wrapper, "max-players").get("input").setValue("30");
    await field(wrapper, "empty").get("input").setValue("");
    await field(wrapper, "literal").get("input").setValue("false");
    await field(wrapper, "long").get("input").setValue("9007199254740995");
    await field(wrapper, "float").get("input").setValue("2.75");
    expect(fixture.config.value).toMatchObject({
      pvp: true,
      motd: "Hello",
      "max-players": 30,
      empty: "",
      literal: "false",
      long: "<__long__>9007199254740995",
      float: "<__float__>2.75"
    });
  });

  it("keeps legacy boolean selection/raw editing and numeric assignment behavior", async () => {
    const values = reactive({ flag: false, number: 20 });
    const boolean = create(LineOption, { optionValue: values, optionKey: "flag" });
    const numeric = create(LineOption, { optionValue: values, optionKey: "number" });
    await settle();
    expect(boolean.find('[role="switch"]').exists()).toBe(false);
    expect(boolean.findComponent({ name: "ASelect" }).exists()).toBe(true);
    await boolean.get("button").trigger("click");
    await boolean.get("input").setValue("raw");
    await numeric.get("input").setValue("30");
    expect(values).toEqual({ flag: "raw", number: "30" });
  });

  it("rebinds replaced configuration objects and writes only the refreshed object", async () => {
    const original = fixture.config.value;
    const wrapper = create(Structured, { card: card() });
    await settle();
    const replacement = { pvp: true, motd: "Refreshed", "max-players": 40 };
    fixture.read.mockImplementationOnce(async () => {
      fixture.config.value = replacement;
      return fixture.config;
    });
    await click(text("TXT_CODE_b76d94e0"));
    expect(field(wrapper, "motd").get<HTMLInputElement>("input").element.value).toBe("Refreshed");
    expect(field(wrapper, "pvp").get('[role="switch"]').attributes("aria-checked")).toBe("true");
    await field(wrapper, "motd").get("input").setValue("New edit");
    await field(wrapper, "pvp").get('[role="switch"]').trigger("click");
    expect(replacement).toMatchObject({ motd: "New edit", pvp: false });
    expect(original).toMatchObject({ motd: "Welcome", pvp: false });
    await click(text("TXT_CODE_abfe9512"));
    fixture.confirm.onOk();
    await settle();
    expect(fixture.write.mock.calls[0][0].data).toMatchObject({
      motd: "New edit",
      pvp: false,
      "max-players": 40
    });
  });

  it("opens the parsed properties editor directly and keeps a focusable Return to the instance", async () => {
    const wrapper = create(Overview, { card: card() });
    await settle();
    expect(wrapper.find(".config-file-row").exists()).toBe(false);
    expect(wrapper.findComponent(Structured).exists()).toBe(true);
    expect(wrapper.find('button[role="switch"][aria-label="pvp"]').exists()).toBe(true);
    const back = wrapper
      .findAll("button")
      .find((button) => button.text() === text("TXT_CODE_backup_to_console"))!;
    expect(back.element.tabIndex).toBe(0);
    back.element.focus();
    expect(document.activeElement).toBe(back.element);
    await back.trigger("click");
    expect(fixture.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/instances/terminal",
        query: expect.objectContaining({ instanceId: "server", daemonId: "node" })
      })
    );
  });

  it("confirms only changed properties, cancels without writing, and skips the next pristine save", async () => {
    const wrapper = create(Structured, { card: card() });
    await settle();
    await field(wrapper, "pvp").get('[role="switch"]').trigger("click");
    expect(Modal.confirm).not.toHaveBeenCalled();
    await keyboardSave();
    await keyboardSave();
    expect(Modal.confirm).toHaveBeenCalledTimes(1);
    expect(fixture.confirm.content).toContain("next time the server starts");
    fixture.confirm.onCancel();
    await settle();
    expect(fixture.write).not.toHaveBeenCalled();
    await click(text("TXT_CODE_abfe9512"));
    fixture.confirm.onOk();
    await settle();
    expect(fixture.write).toHaveBeenCalledTimes(1);
    expect(fixture.write.mock.calls[0][0].data.pvp).toBe(true);
    await click(text("TXT_CODE_abfe9512"));
    expect(Modal.confirm).toHaveBeenCalledTimes(2);
    expect(fixture.write).toHaveBeenCalledTimes(2);
  });

  it.each(["settings.json", "paper.yml", "server.properties.bak"])(
    "does not warn for %s",
    async (path) => {
      const wrapper = create(Structured, { card: card(path) });
      await settle();
      await field(wrapper, "motd").get("input").setValue("Changed");
      await keyboardSave();
      expect(Modal.confirm).not.toHaveBeenCalled();
      expect(fixture.write).toHaveBeenCalledTimes(1);
    }
  );

  it("covers raw Ctrl+S cancellation, accepted save and pristine keyboard save without closing", async () => {
    const wrapper = create(Raw, { daemonId: "node", instanceId: "server" });
    const finished = (wrapper.vm as any).openDialog("./server.properties", "server.properties");
    await settle();
    await page().get("textarea").setValue("pvp=true\n");
    await keyboardSave();
    await keyboardSave();
    expect(Modal.confirm).toHaveBeenCalledTimes(1);
    fixture.confirm.onCancel();
    await settle();
    expect(fixture.raw).toHaveBeenCalledTimes(1);
    expect(message.success).not.toHaveBeenCalled();
    await keyboardSave();
    fixture.confirm.onOk();
    await settle();
    expect(fixture.raw.mock.calls[1][0].data).toEqual({
      target: "./server.properties",
      text: "pvp=true\n"
    });
    expect(wrapper.emitted("save")).toHaveLength(1);
    expect(page().find("textarea").exists()).toBe(true);
    await keyboardSave();
    expect(Modal.confirm).toHaveBeenCalledTimes(2);
    expect(fixture.raw).toHaveBeenCalledTimes(3);
    await click(text("TXT_CODE_3b1cc020"));
    await finished;
  });

  it("covers the raw Save button and preserves its promise/save event contract", async () => {
    const wrapper = create(Raw, { daemonId: "node", instanceId: "server" });
    const finished = (wrapper.vm as any).openDialog("server.properties", "server.properties");
    await settle();
    await page().get("textarea").setValue("motd=Hi\n");
    await click(text("TXT_CODE_abfe9512"));
    fixture.confirm.onOk();
    await settle();
    expect(await finished).toBe("motd=Hi\n");
    expect(wrapper.emitted("save")).toHaveLength(1);
    expect(fixture.raw).toHaveBeenCalledTimes(2);
  });

  it.each(["keyboard", "button"])(
    "ignores an old raw %s confirmation after opening a different file/server",
    async (method) => {
      const wrapper = create(Raw, { daemonId: "node-a", instanceId: "server-a" });
      void (wrapper.vm as any).openDialog("a/server.properties", "server.properties");
      await settle();
      await page().get("textarea").setValue("old text from A");
      if (method === "keyboard") await keyboardSave();
      else await click(text("TXT_CODE_abfe9512"));
      const oldConfirm = fixture.confirm;
      await wrapper.setProps({ daemonId: "node-b", instanceId: "server-b" });
      fixture.text.value = "B content";
      const finishedB = (wrapper.vm as any).openDialog("b/settings.json", "settings.json");
      await settle();
      oldConfirm.onOk();
      await settle();
      expect(fixture.raw.mock.calls.filter(([request]) => "text" in request.data)).toHaveLength(0);
      expect(page().get<HTMLTextAreaElement>("textarea").element.value).toBe("B content");
      expect(wrapper.emitted("save")).toBeUndefined();
      expect(message.success).not.toHaveBeenCalled();
      await page().get("textarea").setValue("B edited");
      await keyboardSave();
      const writes = fixture.raw.mock.calls.filter(([request]) => "text" in request.data);
      expect(writes).toHaveLength(1);
      expect(writes[0][0]).toEqual({
        params: { daemonId: "node-b", uuid: "server-b" },
        data: { target: "b/settings.json", text: "B edited" }
      });
      await click(text("TXT_CODE_3b1cc020"));
      await finishedB;
    }
  );

  it("ignores a stale raw load after the replacement dialog has loaded", async () => {
    let complete!: () => void;
    fixture.raw.mockImplementationOnce(
      () =>
        new Promise<void>((ok) => {
          complete = () => {
            fixture.text.value = "stale A";
            ok();
          };
        })
    );
    const wrapper = create(Raw, { daemonId: "node", instanceId: "server" });
    void (wrapper.vm as any).openDialog("a.txt", "a.txt");
    await settle();
    fixture.text.value = "B content";
    const finishedB = (wrapper.vm as any).openDialog("b.txt", "b.txt");
    await settle();
    complete();
    await settle();
    expect(page().get<HTMLTextAreaElement>("textarea").element.value).toBe("B content");
    await click(text("TXT_CODE_3b1cc020"));
    await finishedB;
  });

  it.each(["keyboard", "button"])(
    "ignores a late admitted raw %s save response without closing or changing B",
    async (method) => {
      let complete!: () => void;
      const wrapper = create(Raw, { daemonId: "node", instanceId: "server" });
      void (wrapper.vm as any).openDialog("a/server.properties", "server.properties");
      await settle();
      await page().get("textarea").setValue("A edited");
      if (method === "keyboard") await keyboardSave();
      else await click(text("TXT_CODE_abfe9512"));
      fixture.raw.mockImplementationOnce(
        () =>
          new Promise<void>((ok) => {
            complete = ok;
          })
      );
      fixture.confirm.onOk();
      await settle();
      expect(fixture.raw.mock.calls[1][0].data).toEqual({
        target: "a/server.properties",
        text: "A edited"
      });
      fixture.text.value = "B content";
      const finishedB = (wrapper.vm as any).openDialog("b.txt", "b.txt");
      await settle();
      complete();
      await settle();
      expect(page().get<HTMLTextAreaElement>("textarea").element.value).toBe("B content");
      expect(wrapper.emitted("save")).toBeUndefined();
      expect(message.success).not.toHaveBeenCalled();
      await click(text("TXT_CODE_3b1cc020"));
      await finishedB;
    }
  );

  it.each(["replacement", "unmount"])(
    "does not admit a structured write after %s while confirmation waits",
    async (change) => {
      const wrapper = create(Structured, { card: card() });
      await settle();
      await field(wrapper, "motd").get("input").setValue("A edited");
      await keyboardSave();
      if (change === "replacement") await wrapper.setProps({ card: card("settings.json") });
      else {
        wrapper.unmount();
        wrappers = wrappers.filter((item) => item !== wrapper);
      }
      fixture.confirm.onOk();
      await settle();
      expect(fixture.write).not.toHaveBeenCalled();
      expect(message.success).not.toHaveBeenCalled();
    }
  );

  it("recognizes Windows paths and leaves unchanged properties unprompted", async () => {
    expect(await confirmServerPropertiesSave("server.properties", false)).toBe(true);
    const pending = confirmServerPropertiesSave("config\\server.properties", true);
    expect(Modal.confirm).toHaveBeenCalledTimes(1);
    fixture.confirm.onCancel();
    expect(await pending).toBe(false);
  });
});

describe("Java presentation and acknowledgements", () => {
  const openJava = async () => {
    const instance = reactive({
      status: 3,
      info: { currentPlayers: 2 },
      config: {
        java: { id: "A", customValue: "Keep Java metadata" },
        startCommand: "java -jar server.jar",
        nickname: "Unsaved name",
        stopCommand: "local-stop",
        eventTask: { autoStart: true }
      }
    });
    const wrapper = create(Java, {
      instanceInfo: instance,
      daemonId: "node",
      instanceId: "server"
    });
    await (wrapper.vm as any).openDialog();
    await settle();
    return instance;
  };
  it.each([false, undefined, "true", { success: true }])(
    "preserves selection and reports no success for ack %j",
    async (ack) => {
      fixture.select.mockResolvedValue(ref(ack));
      const instance = await openJava();
      await click(text("TXT_CODE_java_select"));
      expect(instance.config.java.id).toBe("A");
      expect(instance.config.startCommand).toBe("java -jar server.jar");
      expect(fixture.instance).not.toHaveBeenCalled();
      expect(message.success).not.toHaveBeenCalled();
      expect(message.error).toHaveBeenCalledWith(text("TXT_CODE_java_not_confirmed"));
    }
  );
  it("preserves selection on rejection and displays the backend script guidance", async () => {
    const reason = text("TXT_CODE_java_selection.scriptLauncher");
    fixture.select.mockRejectedValue(new Error(reason));
    const instance = await openJava();
    await click(text("TXT_CODE_java_select"));
    expect(instance.config.java.id).toBe("A");
    expect(instance.config.startCommand).toBe("java -jar server.jar");
    expect(fixture.instance).not.toHaveBeenCalled();
    expect(message.error).toHaveBeenCalledWith(reason);
    expect(message.success).not.toHaveBeenCalled();
  });
  it("accepts true once, prevents concurrent selection and distinguishes running A from configured B", async () => {
    let resolve!: (value: unknown) => void;
    fixture.select.mockImplementation(
      () =>
        new Promise((ok) => {
          resolve = ok;
        })
    );
    const instance = await openJava();
    await click(text("TXT_CODE_java_select"));
    await click(text("TXT_CODE_java_select"));
    expect(fixture.select).toHaveBeenCalledTimes(1);
    expect(instance.config.java.id).toBe("A");
    resolve(ref(true));
    await settle();
    expect(instance.config.java.id).toBe("B");
    expect(instance.config.startCommand).toBe('{mcsm_java} -jar "server files/server.jar"');
    expect(instance.status).toBe(3);
    expect(instance.info.currentPlayers).toBe(2);
    expect(fixture.instance).toHaveBeenCalledWith({
      forceRequest: true,
      params: { daemonId: "node", uuid: "server" }
    });
    expect(message.success).toHaveBeenCalledWith(text("TXT_CODE_java_saved"));
    const rows = page().findAll("tbody tr");
    expect(rows.find((r) => r.text().includes("A"))!.text()).toContain(
      text("TXT_CODE_java_running_here")
    );
    expect(rows.find((r) => r.text().includes("B"))!.text()).toContain(
      text("TXT_CODE_java_next_start")
    );
    expect(page().text()).not.toContain("Docker containers");
  });
  it("merges only authoritative Java fields and preserves unrelated unsaved configuration", async () => {
    let complete!: (value: unknown) => void;
    fixture.instance.mockImplementationOnce(
      () =>
        new Promise((ok) => {
          complete = ok;
        })
    );
    const instance = await openJava();
    const originalConfig = instance.config;
    const originalJava = instance.config.java;
    await click(text("TXT_CODE_java_select"));
    instance.config.nickname = "Edited while reading";
    instance.config.eventTask.autoStart = false;
    complete(
      ref({
        config: {
          java: { id: "B", customValue: "Remote metadata" },
          startCommand: "{mcsm_java} -Xmx8G -jar server.jar",
          nickname: "Remote name",
          stopCommand: "remote-stop",
          eventTask: { autoStart: true }
        }
      })
    );
    await settle();
    expect(instance.config).toBe(originalConfig);
    expect(instance.config.java).toBe(originalJava);
    expect(instance.config).toEqual({
      java: { id: "B", customValue: "Keep Java metadata" },
      startCommand: "{mcsm_java} -Xmx8G -jar server.jar",
      nickname: "Edited while reading",
      stopCommand: "local-stop",
      eventTask: { autoStart: false }
    });
    expect(page().find('[role="alert"]').exists()).toBe(false);
  });

  it("retains accepted selection after a failed authoritative read and retries without another write", async () => {
    fixture.instance.mockRejectedValueOnce(new Error("Read timed out"));
    const instance = await openJava();
    await click(text("TXT_CODE_java_select"));
    expect(instance.config.java.id).toBe("B");
    expect(instance.config.startCommand).toBe("java -jar server.jar");
    expect(message.success).toHaveBeenCalledWith(text("TXT_CODE_java_saved"));
    expect(message.error).not.toHaveBeenCalled();
    expect(page().get('[role="alert"]').text()).toContain(text("TXT_CODE_java_refresh_needed"));
    await click(text("TXT_CODE_b76d94e0"));
    expect(fixture.select).toHaveBeenCalledTimes(1);
    expect(fixture.instance).toHaveBeenCalledTimes(2);
    expect(instance.config.startCommand).toBe('{mcsm_java} -jar "server files/server.jar"');
    expect(instance.config.java.id).toBe("B");
    expect(page().find('[role="alert"]').exists()).toBe(false);
  });

  it("retains saved configuration with refresh guidance when only the runtime list read fails", async () => {
    const instance = await openJava();
    fixture.list.mockRejectedValueOnce(new Error("Catalog timed out"));
    await click(text("TXT_CODE_java_select"));
    expect(instance.config.java.id).toBe("B");
    expect(instance.config.startCommand).toBe('{mcsm_java} -jar "server files/server.jar"');
    expect(message.success).toHaveBeenCalledWith(text("TXT_CODE_java_saved"));
    expect(message.error).not.toHaveBeenCalled();
    expect(page().get('[role="alert"]').text()).toContain(text("TXT_CODE_java_refresh_needed"));
    await click(text("TXT_CODE_b76d94e0"));
    expect(fixture.select).toHaveBeenCalledTimes(1);
    expect(page().find('[role="alert"]').exists()).toBe(false);
  });

  it("does not overwrite a startup command edited while the authoritative read waits", async () => {
    let complete!: (value: unknown) => void;
    fixture.instance.mockImplementationOnce(
      () =>
        new Promise((ok) => {
          complete = ok;
        })
    );
    const instance = await openJava();
    await click(text("TXT_CODE_java_select"));
    instance.config.startCommand = "java -Xmx12G -jar user-edited.jar";
    complete(ref({ config: { java: { id: "B" }, startCommand: "{mcsm_java} -jar server.jar" } }));
    await settle();
    expect(instance.config.startCommand).toBe("java -Xmx12G -jar user-edited.jar");
    expect(instance.config.java.id).toBe("B");
    expect(page().get('[role="alert"]').text()).toContain(text("TXT_CODE_java_refresh_needed"));
  });

  it("ignores authoritative Java fields after the dialog receives a replacement instance", async () => {
    let complete!: (value: unknown) => void;
    fixture.instance.mockImplementationOnce(
      () =>
        new Promise((ok) => {
          complete = ok;
        })
    );
    const original = await openJava();
    await click(text("TXT_CODE_java_select"));
    const replacement = reactive({
      config: { java: { id: "C" }, startCommand: "java -jar other.jar" }
    });
    await wrappers[wrappers.length - 1].setProps({
      instanceInfo: replacement,
      instanceId: "other"
    });
    complete(ref({ config: { java: { id: "B" }, startCommand: "{mcsm_java} -jar server.jar" } }));
    await settle();
    expect(replacement.config).toEqual({ java: { id: "C" }, startCommand: "java -jar other.jar" });
    expect(original.config.startCommand).toBe("java -jar server.jar");
  });

  it("shows Downloading separately and keeps downloading selection disabled", async () => {
    fixture.list.mockResolvedValue(ref([runtime("A"), runtime("B", [], true)]));
    await openJava();
    expect(page().text()).toContain(text("TXT_CODE_java_downloading"));
    const button = page()
      .findAll("button")
      .find((b) => b.text() === text("TXT_CODE_java_select"))!;
    expect(button.attributes("disabled")).toBeDefined();
  });
  it("does not announce a failed Add and releases its busy guard for retry", async () => {
    fixture.addDialog.mockResolvedValue({ name: "Local Java", path: "/java" });
    fixture.add.mockRejectedValue(new Error("Invalid Java path"));
    await openJava();
    await click(text("TXT_CODE_8900e7ee"));
    expect(message.success).not.toHaveBeenCalled();
    expect(message.error).toHaveBeenCalledWith("Invalid Java path");
    fixture.add.mockResolvedValue(ref(true));
    await click(text("TXT_CODE_8900e7ee"));
    expect(fixture.add).toHaveBeenCalledTimes(2);
    expect(message.success).toHaveBeenCalledWith(text("TXT_CODE_10f0f8d"));
  });
  it("downloads only after acknowledgement and serializes duplicate clicks", async () => {
    let complete!: (value: unknown) => void;
    fixture.downloadDialog.mockResolvedValue({
      name: "New Java",
      version: "21",
      downloadUrl: "https://example.invalid/java"
    });
    fixture.download.mockImplementationOnce(
      () =>
        new Promise((ok) => {
          complete = ok;
        })
    );
    await openJava();
    await click(text("TXT_CODE_9c48100e"));
    await click(text("TXT_CODE_9c48100e"));
    expect(fixture.download).toHaveBeenCalledTimes(1);
    expect(message.success).not.toHaveBeenCalled();
    complete(ref(false));
    await settle();
    expect(message.success).not.toHaveBeenCalled();
    fixture.download.mockResolvedValue(ref(true));
    await click(text("TXT_CODE_9c48100e"));
    expect(message.success).toHaveBeenCalledWith(text("TXT_CODE_5e7a4c02"));
  });

  it("keeps Delete confirmation functional and returns to usable controls after backend rejection", async () => {
    await openJava();
    const row = page()
      .findAll("tbody tr")
      .find((item) => item.text().includes("B"))!;
    await row
      .findAll("button")
      .find((button) => button.text() === text("TXT_CODE_ecbd7449"))!
      .trigger("click");
    await settle();
    expect(fixture.remove).not.toHaveBeenCalled();
    fixture.remove.mockRejectedValueOnce(new Error("Selected by another server"));
    await vi.waitFor(() => expect(page().find(".ant-popconfirm-buttons").exists()).toBe(true));
    const confirm = page().get(".ant-popconfirm-buttons .ant-btn-primary");
    await confirm.trigger("click");
    await settle();
    expect(fixture.remove).toHaveBeenCalledWith(expect.objectContaining({ data: { id: "B" } }));
    expect(message.error).toHaveBeenCalledWith("Selected by another server");
    expect(
      page()
        .findAll("button")
        .find((button) => button.text() === text("TXT_CODE_java_select"))!
        .attributes("disabled")
    ).toBeUndefined();
  });
});
