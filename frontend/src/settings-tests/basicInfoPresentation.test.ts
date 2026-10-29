import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick, reactive, ref } from "vue";
import Antd, { message } from "ant-design-vue";
import labels from "../../../languages/en_US.json";

const api = vi.hoisted(() => ({
  info: null as any,
  admin: null as any,
  route: null as any,
  read: vi.fn(),
  icon: vi.fn(),
  releases: vi.fn(),
  navigate: vi.fn(),
  tags: vi.fn(),
  remove: vi.fn(),
  error: vi.fn()
}));
vi.mock("@/lang/i18n", () => ({
  t: (key: string, args: Record<string, unknown> = {}) => {
    let value = (labels as Record<string, string>)[key] || key;
    for (const [name, replacement] of Object.entries(args))
      value = value.replace("{" + name + "}", String(replacement));
    return value;
  }
}));
vi.mock("vue-router", () => ({ useRoute: () => api.route }));
vi.mock("@/hooks/useAppRouters", () => ({ useAppRouters: () => ({ toPage: api.navigate }) }));
vi.mock("@/stores/useAppStateStore", () => ({ useAppStateStore: () => ({ isAdmin: api.admin }) }));
vi.mock("@/hooks/useFileManager", () => ({ getFileConfigAddr: (value: any) => value.addr }));
vi.mock("@/tools/validator", () => ({ reportErrorMsg: api.error }));
vi.mock("@/components/fc", () => ({
  openInstanceTagsEditor: api.tags,
  useDeleteInstanceDialog: api.remove
}));
vi.mock("@/services/apis/instance", () => ({
  getInstanceInfo: () => ({
    state: api.info,
    execute: api.read,
    isLoading: ref(false),
    isReady: ref(true)
  }),
  getConfigFile: vi.fn(),
  updateConfigFile: vi.fn()
}));
vi.mock("@/services/apis/fileManager", () => ({ downloadAddress: () => ({ execute: api.icon }) }));
vi.mock("@/services/apis/modpack", () => ({
  modpackVersions: () => ({ execute: api.releases }),
  serverVersionsGet: () => ({ execute: api.releases })
}));
import BaseInfo from "@/widgets/instance/BaseInfo.vue";
import InstanceVersionInfo from "@/components/InstanceVersionInfo.vue";
import SecondaryActions from "@/components/InstanceSecondaryActions.vue";
import { useLayoutContainerStore } from "@/stores/useLayoutContainerStore";

const tr = (key: string) => (labels as Record<string, string>)[key] || key;
const settle = async () => {
  await flushPromises();
  await nextTick();
};
let wrappers: VueWrapper[] = [];
let project = 0;
const card = (meta: Record<string, string> = {}) =>
  ({
    id: "basic",
    title: "Basic information",
    meta: { instanceId: "alpha", daemonId: "node-a", ...meta }
  }) as any;
const server = () => ({
  instanceUuid: "alpha",
  status: 3,
  started: 8,
  autoRestarted: 0,
  gameEndpoint: {
    host: "games.example.invalid",
    hostSource: "gameHost",
    port: 25571,
    source: "server.properties",
    protocol: "tcp"
  },
  config: {
    nickname: "Long community server",
    type: "minecraft/java/fabric",
    processType: "general",
    tag: ["Friends"],
    cwd: "/servers/community",
    createDatetime: 1700000000000,
    lastDatetime: 1700000010000,
    endTime: 0,
    packInfo: {
      source: "modrinth",
      projectId: "pack-" + ++project,
      fileId: "old",
      projectName: "Community Pack",
      versionName: "Release 3",
      mcVersion: "1.21.1",
      loader: "fabric"
    }
  },
  info: {
    mcPingOnline: true,
    currentPlayers: 0,
    maxPlayers: 20,
    version: "1.21.1",
    memoryUsage: 1073741824,
    memoryLimit: 4294967296
  }
});
const create = (value = card()) => {
  const wrapper = mount(BaseInfo, {
    props: { card: value },
    attachTo: document.body,
    global: { plugins: [Antd], stubs: { DockerInfo: true } }
  });
  wrappers.push(wrapper);
  return wrapper;
};
const menuAction = async (wrapper: VueWrapper, action: "tags" | "delete") => {
  await wrapper.get(".secondary-icon").trigger("click");
  await settle();
  await wrapper.findAll('[role="menuitem"]')[action === "tags" ? 0 : 1].trigger("click");
  await settle();
};
beforeEach(() => {
  vi.clearAllMocks();
  api.info = ref(server());
  api.admin = ref(true);
  api.route = reactive({ query: {} });
  api.read.mockImplementation(async () => api.info);
  api.icon.mockResolvedValue(ref(undefined));
  api.releases.mockResolvedValue(
    ref([
      {
        id: "new",
        name: "Release 4",
        game_versions: ["1.21.1"],
        loaders: ["fabric"],
        version_type: "release"
      },
      {
        id: "old",
        name: "Release 3",
        game_versions: ["1.21.1"],
        loaders: ["fabric"],
        version_type: "release"
      }
    ])
  );
  api.tags.mockResolvedValue(undefined);
  api.remove.mockResolvedValue(false);
  useLayoutContainerStore().containerState.isDesignMode = false;
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn()
  })) as any;
  const original = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => original(el));
  vi.spyOn(message, "success").mockImplementation(() => undefined as any);
});
afterEach(async () => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers = [];
  await settle();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Basic Information with native data and actions", () => {
  it("renders actual endpoint/protocol, installed versions and the existing update pill with one initial instance read", async () => {
    const wrapper = create();
    await settle();
    expect(wrapper.get("h2").text()).toBe("Long community server");
    expect(wrapper.get(".basic-address").text()).toContain("games.example.invalid:25571");
    expect(wrapper.get(".basic-protocol").text()).toBe("TCP");
    expect(wrapper.get(".pack-name").text()).toContain("Community Pack");
    expect(wrapper.getComponent(InstanceVersionInfo).text()).toContain("Release 3");
    expect(wrapper.getComponent(InstanceVersionInfo).text()).toContain("1.21.1");
    expect(wrapper.get(".version-status").attributes("data-status")).toBe("available");
    expect(wrapper.get(".basic-stats").text()).toContain("0 / 20");
    expect(wrapper.get(".basic-stats").text()).toContain("1.00 GiB / 4.00 GiB");
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(api.icon).toHaveBeenCalledTimes(1);
    expect(api.releases).toHaveBeenCalledTimes(1);
    expect(wrapper.get(".basic-address").find(".ant-typography-copy").exists()).toBe(true);
    expect(wrapper.findAll(".basic-technical .ant-typography-copy")).toHaveLength(3);
    expect(wrapper.findAll("details")).toHaveLength(2);
    expect(wrapper.getComponent(SecondaryActions).props("menu")).toBe(true);
  });

  it("retains actual differing reported version text without fixture normalization", async () => {
    api.info.value.info.version = "Paper 1.21.2 (git-735)";
    const wrapper = create();
    await settle();
    expect(wrapper.get(".running-version").text()).toContain("Paper 1.21.2 (git-735)");
    expect(wrapper.getComponent(InstanceVersionInfo).text()).toContain("1.21.1");
    api.info.value.info.version = "1.21.1";
    await settle();
    expect(wrapper.find(".running-version").exists()).toBe(false);
  });

  it.each([0, 2, -1])(
    "does not report stale players, memory or running versions for status %s",
    async (status) => {
      api.info.value.status = status;
      api.info.value.info.version = "stale runtime";
      const wrapper = create();
      await settle();
      const stats = wrapper.get(".basic-stats").text();
      expect(stats).not.toContain("0 / 20");
      expect(stats).not.toContain("GiB");
      expect(stats).toContain(
        tr(status === 0 ? "TXT_CODE_info_stopped_metrics" : "TXT_CODE_info_unavailable")
      );
      expect(wrapper.find(".running-version").exists()).toBe(false);
      expect(wrapper.getComponent(InstanceVersionInfo).text()).not.toContain("stale runtime");
    }
  );

  it("distinguishes missing data from a measured zero without inventing an installed version", async () => {
    api.info.value.info = {};
    api.info.value.config.packInfo = undefined;
    api.info.value.config.tag = undefined;
    const wrapper = create();
    await settle();
    expect(wrapper.get(".basic-stats").text()).toContain(tr("TXT_CODE_info_unavailable"));
    expect(wrapper.get(".basic-stats").text()).not.toContain("0 / 0");
    expect(wrapper.get(".basic-tags").text()).toContain(tr("TXT_CODE_info_no_tags"));
    expect(wrapper.getComponent(InstanceVersionInfo).text()).toContain(
      tr("TXT_CODE_import_loader_unknown")
    );
    api.info.value.info = { memoryUsage: 0, mcPingOnline: true, currentPlayers: 0 };
    await settle();
    expect(wrapper.get(".basic-stats").text()).toContain("0.00 B");
    expect(wrapper.get(".basic-stats").text()).toContain("0 / " + tr("TXT_CODE_info_unavailable"));
  });

  it("keeps missing-daemon and missing-host guidance instead of making up an address", async () => {
    api.info.value.gameEndpoint = undefined;
    const wrapper = create();
    await settle();
    expect(wrapper.get(".basic-endpoint").text()).toContain(
      tr("TXT_CODE_game_endpoint_daemon_update_hint")
    );
    expect(wrapper.find(".basic-address").exists()).toBe(false);
    api.info.value.gameEndpoint = { source: "server.properties", port: 25565, protocol: "tcp" };
    await settle();
    expect(wrapper.get(".basic-endpoint").text()).toContain(
      tr("TXT_CODE_game_endpoint_host_unavailable")
    );
    expect(wrapper.find(".basic-address").exists()).toBe(false);
  });

  it("uses Bedrock UDP and stored BDS provenance while keeping unavailable player counts honest", async () => {
    api.info.value.config.type = "minecraft/bedrock/bds";
    api.info.value.config.packInfo = {
      source: "bedrock",
      versionName: "1.21.100",
      mcVersion: "1.21.100"
    };
    api.info.value.gameEndpoint.protocol = "udp";
    api.info.value.gameEndpoint.port = 19142;
    api.info.value.info.mcPingOnline = false;
    const wrapper = create();
    await settle();
    expect(wrapper.get(".basic-protocol").text()).toBe("UDP");
    expect(wrapper.get(".basic-address").text()).toContain(":19142");
    expect(wrapper.getComponent(InstanceVersionInfo).text()).toContain("1.21.100");
    expect(wrapper.getComponent(InstanceVersionInfo).text()).toContain(
      tr("TXT_CODE_instance_version_bedrock_bds")
    );
    expect(wrapper.get(".basic-stats").text()).toContain(tr("TXT_CODE_info_unavailable"));
  });

  it("keeps ordinary process information and optional legacy ports outside the game presentation", async () => {
    api.info.value.config.type = "universal";
    api.info.value.config.packInfo = undefined;
    api.info.value.config.processType = "docker";
    api.info.value.info.allocatedPorts = [{ host: "25572", container: 25565, protocol: "tcp" }];
    const wrapper = create();
    await settle();
    expect(wrapper.find(".basic-endpoint").exists()).toBe(false);
    expect(wrapper.findComponent(InstanceVersionInfo).exists()).toBe(false);
    expect(wrapper.get(".legacy-ports").text()).toContain("25572");
    expect(wrapper.get(".legacy-ports").element.closest("details")).not.toBeNull();
    expect(api.icon).not.toHaveBeenCalled();
    expect(api.releases).not.toHaveBeenCalled();
  });

  it("uses the native reported-version fallback once for legacy Bedrock metadata", async () => {
    api.info.value.config.type = "minecraft/bedrock";
    api.info.value.config.packInfo = { source: "bedrock", versionName: "1.21.100" };
    api.info.value.info.version = "1.21.101";
    const wrapper = create();
    await settle();
    expect(wrapper.getComponent(InstanceVersionInfo).text()).toContain("1.21.100");
    expect(wrapper.getComponent(InstanceVersionInfo).text()).toContain("1.21.101");
    expect(wrapper.find(".running-version").exists()).toBe(false);
  });

  it("reports a failed native tag refresh only while its captured context still owns the view", async () => {
    const wrapper = create();
    await settle();
    const listener = (wrapper.getComponent(SecondaryActions).vm as any).$.vnode.props
      .onChanged as () => Promise<void>;
    api.read.mockRejectedValueOnce(new Error("Refresh failed"));
    await listener();
    expect(api.error).toHaveBeenCalledWith(expect.objectContaining({ message: "Refresh failed" }));
    expect(api.navigate).not.toHaveBeenCalled();
  });

  it("uses native Tag and Delete hooks, cancels silently and refreshes acknowledged saved tags", async () => {
    const wrapper = create();
    await settle();
    await menuAction(wrapper, "tags");
    expect(api.tags).toHaveBeenCalledWith("alpha", "node-a", ["Friends"]);
    expect(api.read).toHaveBeenCalledTimes(1);
    await menuAction(wrapper, "delete");
    expect(api.remove).toHaveBeenCalledWith("alpha", "node-a", "Long community server");
    expect(api.navigate).not.toHaveBeenCalled();
    api.tags.mockImplementationOnce(async () => {
      api.info.value.config.tag = ["Saved"];
      return ["Saved"];
    });
    await menuAction(wrapper, "tags");
    expect(wrapper.get(".basic-tags").text()).toBe("Saved");
    expect(api.read.mock.calls.some(([request]) => request.forceRequest === true)).toBe(true);
    api.remove.mockResolvedValueOnce(true);
    await menuAction(wrapper, "delete");
    expect(api.navigate).toHaveBeenCalledWith({
      path: "/",
      query: { instanceId: undefined, daemonId: undefined }
    });
  });

  it.each(["changed", "deleted"])(
    "fences delayed %s callbacks after an away-and-back context change",
    async (event) => {
      const original = card();
      const wrapper = create(original);
      await settle();
      const listener = (wrapper.getComponent(SecondaryActions).vm as any).$.vnode.props[
        event === "changed" ? "onChanged" : "onDeleted"
      ] as () => Promise<void>;
      expect(listener).toBeTypeOf("function");
      await wrapper.setProps({ card: card({ instanceId: "beta" }) });
      await wrapper.setProps({ card: original });
      await listener();
      await settle();
      expect(api.read).toHaveBeenCalledTimes(1);
      expect(api.navigate).not.toHaveBeenCalled();
    }
  );

  it("disables native actions in design mode and ignores old callbacks after unmount", async () => {
    const wrapper = create();
    await settle();
    const listener = (wrapper.getComponent(SecondaryActions).vm as any).$.vnode.props
      .onDeleted as () => void;
    useLayoutContainerStore().containerState.isDesignMode = true;
    await nextTick();
    expect(wrapper.get(".secondary-icon").attributes("disabled")).toBeDefined();
    listener();
    expect(api.navigate).not.toHaveBeenCalled();
    wrapper.unmount();
    wrappers = [];
    listener();
    expect(api.navigate).not.toHaveBeenCalled();
  });

  it("invalidates native action callbacks cleanly when navigation removes route context", async () => {
    api.route.query = { instanceId: "alpha", daemonId: "node-a" };
    const wrapper = create({ id: "route", title: "Information", meta: {} } as any);
    await settle();
    const listener = (wrapper.getComponent(SecondaryActions).vm as any).$.vnode.props
      .onDeleted as () => void;
    expect(() => {
      api.route.query = {};
    }).not.toThrow();
    listener();
    await settle();
    expect(api.navigate).not.toHaveBeenCalled();
    expect(wrapper.get(".secondary-icon").attributes("disabled")).toBeDefined();
  });
});
