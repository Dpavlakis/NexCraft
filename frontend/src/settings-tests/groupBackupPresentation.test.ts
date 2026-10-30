import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, toRaw, type Component } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import curseforgeIcon from "@/assets/curseforge.svg";
import modrinthIcon from "@/assets/modrinth.svg";
import ftbIcon from "@/assets/ftb.svg";
import { backupKind, backupSize, backupTime } from "@/tools/backupPresentation";
import { groupServers, serverGroupKind } from "@/tools/serverGroups";

vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
import ServerGroup from "@/widgets/instance/ServerGroup.vue";
import ServerSourceBadge from "@/widgets/instance/ServerSourceBadge.vue";
import BackupList from "@/widgets/instance/BackupList.vue";

const sourceInstance = (source?: string, name = "imported-curseforge.zip") => ({
  name,
  config: { packInfo: source === undefined ? undefined : { source } }
});

describe("server grouping metadata", () => {
  it.each(["curseforge", "modrinth", "ftb"])(
    "links %s only from actual provider metadata",
    (source) => {
      expect(serverGroupKind(source)).toBe("modpack");
    }
  );
  it.each([
    "vanilla",
    "serverjar",
    "bedrock",
    "import",
    "unknown",
    "CurseForge",
    undefined,
    null,
    ""
  ])("keeps %s custom without inventing an import origin", (source) => {
    expect(serverGroupKind(source)).toBe("custom");
  });
  it("preserves loaded page order and object identity without looking at filenames", () => {
    const page = [
      sourceInstance("modrinth"),
      sourceInstance(),
      sourceInstance("ftb"),
      sourceInstance("serverjar")
    ];
    const groups = groupServers(page, (item) => item.config.packInfo?.source);
    expect(groups.map((g) => g.items)).toEqual([
      [page[0], page[2]],
      [page[1], page[3]]
    ]);
    expect(groups[0].items[0]).toBe(page[0]);
    expect(page).toHaveLength(4);
  });
  it.each(["curseforge", "modrinth", "ftb"])(
    "shows the bundled %s asset, not a guessed badge",
    (source) => {
      const badge = mount(ServerSourceBadge, { props: { source } });
      expect(badge.get("img").attributes("src")).toBe(
        (
          { curseforge: curseforgeIcon, modrinth: modrinthIcon, ftb: ftbIcon } as Record<
            string,
            string
          >
        )[source]
      );
      badge.unmount();
    }
  );
  it.each(["unknown", "constructor", "__proto__"])(
    "does not label unlinked %s metadata as a provider",
    (source) => {
      const badge = mount(ServerSourceBadge, { props: { source } });
      expect(badge.find("img").exists()).toBe(false);
      badge.unmount();
    }
  );
});

it.each([{ source: ["curseforge"] }, { source: Object("modrinth") }])(
  "does not coerce non-string provider metadata into a badge",
  ({ source }) => {
    expect(serverGroupKind(source)).toBe("custom");
    const badge = mount(ServerSourceBadge, {
      props: { source: source as unknown as string },
      global: { config: { warnHandler: () => {} } }
    });
    expect(badge.find("img").exists()).toBe(false);
    badge.unmount();
  }
);
describe("server group batch visibility", () => {
  it("starts expanded, collapses through a native button, then forces selected cards visible during batch", async () => {
    const group = mount(ServerGroup, {
      props: { kind: "modpack", count: 1 },
      slots: { default: '<button data-card="pack">selectable card</button>' }
    });
    const toggle = group.get(".server-group-toggle");
    expect(toggle.element.tagName).toBe("BUTTON");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(group.find("[data-card]").exists()).toBe(false);
    await group.setProps({ forceOpen: true });
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(group.find("[data-card]").exists()).toBe(true);
    await toggle.trigger("click");
    expect(group.find("[data-card]").exists()).toBe(true);
    await group.setProps({ forceOpen: false });
    expect(group.find("[data-card]").exists()).toBe(false);
    group.unmount();
  });
});

describe("backup kind naming contract", () => {
  const uuid = "6aee028a-29f2-47f4-8233-2f12d8c7c98b";
  it.each([
    ["world-20261029-142101.zip", "world"],
    ["world-20260923-080509.zip", "world"],
    ["backup-20260923-081201.zip", "server"],
    [`world-20261029-142101-${uuid}.zip`, "world"],
    ["backup-20261029-142101.zip", "server"],
    [`backup-20261029-142101-${uuid}.zip`, "server"],
    ["backup-20261029-142101", "server"],
    [`backup-20261029-142101-${uuid}`, "server"],
    ["imported-server.zip", "unknown"],
    ["world-notes.zip", "unknown"],
    ["backup-my-world.zip", "unknown"],
    ["snapshot-world-20261029-142101.zip", "unknown"],
    ["world-20261029-142101.zip.bak", "unknown"],
    ["world-20261029-142101-random.zip", "unknown"],
    ["../world-20261029-142101.zip", "unknown"],
    ["world-20261029-142101.zip\n", "unknown"],
    ["backup-20261029-142101.zip\r", "unknown"]
  ])("classifies %s as %s", (name, kind) => expect(backupKind(name)).toBe(kind));
  it("uses readable size and handles unavailable metadata", () => {
    expect(backupSize(1536)).toBe("1.50 KB");
    expect(backupSize(0)).toBe("0 B");
    expect(backupSize(NaN)).toBe("–");
    expect(backupTime(0)).toBe("–");
    expect(backupTime(Infinity)).toBe("–");
    expect(backupTime(Date.UTC(2026, 9, 29))).not.toBe("–");
  });
});

const buttonStub = defineComponent({
  props: { disabled: Boolean },
  setup(props, { slots }) {
    return () => h("button", { disabled: props.disabled }, slots.default?.());
  }
});
const confirmStub = defineComponent({
  props: { disabled: Boolean, title: String },
  emits: ["confirm"],
  setup(props, { slots, emit }) {
    return () =>
      h("div", { "data-confirm": props.title }, [
        slots.default?.(),
        h(
          "button",
          { disabled: props.disabled, "data-approve": "", onClick: () => emit("confirm") },
          "approve"
        )
      ]);
  }
});
const listStubs = {
  "a-button": buttonStub,
  "a-popconfirm": confirmStub,
  "a-tag": { template: "<span><slot /></span>" },
  "a-empty": { template: "<div />" },
  "a-pagination": { props: ["current", "total", "pageSize"], template: "<div />" }
};

describe("backup list action identity and pagination", () => {
  it("retains unknown archives and emits the exact API entry only after confirmation", async () => {
    const record = { name: "unknown archive with spaces.zip", size: 500, time: 123456789 };
    const list = mount(BackupList, {
      props: { backups: [record], taskRunning: false },
      global: { stubs: listStubs }
    });
    const row = list.get("li");
    expect(row.get(".backup-filename").text()).toBe(record.name);
    await row.get(".backup-actions > button").trigger("click");
    expect(toRaw(list.emitted("download")?.[0][0])).toBe(record);
    expect(list.emitted("restore")).toBeUndefined();
    expect(list.emitted("remove")).toBeUndefined();
    await row
      .get('[data-confirm="TXT_CODE_backup_restore_confirm"] [data-approve]')
      .trigger("click");
    await row
      .get('[data-confirm="TXT_CODE_backup_delete_confirm"] [data-approve]')
      .trigger("click");
    expect(toRaw(list.emitted("restore")?.[0][0])).toBe(record);
    expect(toRaw(list.emitted("remove")?.[0][0])).toBe(record);
    list.unmount();
  });
  it("disables restore while the existing task runs, keeping download and delete available", async () => {
    const list = mount(BackupList, {
      props: {
        backups: [{ name: "world-20261029-142101.zip", size: 5, time: 1 }],
        taskRunning: true
      },
      global: { stubs: listStubs }
    });
    const restore = list.get('[data-confirm="TXT_CODE_backup_restore_confirm"]');
    expect(
      restore.findAll("button").every((button) => button.attributes("disabled") !== undefined)
    ).toBe(true);
    await restore.get("[data-approve]").trigger("click");
    expect(list.emitted("restore")).toBeUndefined();
    expect(list.get(".backup-actions > button").attributes("disabled")).toBeUndefined();
    expect(
      list
        .get('[data-confirm="TXT_CODE_backup_delete_confirm"] [data-approve]')
        .attributes("disabled")
    ).toBeUndefined();
    list.unmount();
  });
  it("keeps 10-entry pages and clamps the last page after deletion", async () => {
    const backups = Array.from({ length: 11 }, (_, i) => ({
      name: `archive-${i}.zip`,
      size: i,
      time: 1
    }));
    const list = mount(BackupList, {
      props: { backups, taskRunning: false },
      global: { stubs: listStubs }
    });
    expect(list.findAll("li")).toHaveLength(10);
    const vm = (list.vm as any).$.setupState;
    vm.page = 2;
    await nextTick();
    expect(list.findAll("li")).toHaveLength(1);
    await list.setProps({ backups: backups.slice(0, 10) });
    expect(list.findAll("li")).toHaveLength(10);
    list.unmount();
  });
});

const api = vi.hoisted(() => ({
  open: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  eula: vi.fn(),
  download: vi.fn(),
  restore: vi.fn(),
  status: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  push: vi.fn()
}));

vi.mock("@/hooks/useAppRouters", () => ({ useAppRouters: () => ({ toPage: api.push }) }));
vi.mock("@/hooks/useScreen", () => ({ useScreen: () => ({ isPhone: ref(false) }) }));
vi.mock("@/hooks/useCardTools", () => ({
  useLayoutCardTools: () => ({
    getMetaOrRouteValue: (key: string) => (key === "daemonId" ? "node-b" : "raw-instance-uuid")
  })
}));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }) }));
vi.mock("@/hooks/useFileManager", () => ({ getFileConfigAddr: () => "http://fixture.test" }));
vi.mock("@/tools/protocol", () => ({ parseForwardAddress: (address: string) => address }));
vi.mock("@/hooks/useGameEndpoint", () => ({ useGameEndpoint: () => ({}) }));
vi.mock("@/hooks/useInstance", () => ({ TYPE_UNIVERSAL: "universal", verifyEULA: api.eula }));
vi.mock("@/components/fc/index", () => ({ useDeleteInstanceDialog: vi.fn() }));
vi.mock("@/components/InstanceVersionInfo.vue", () => ({ default: { render: () => null } }));
vi.mock("@/widgets/instance/dialogs/BackupExclusions.vue", () => ({
  default: { render: () => null }
}));
vi.mock("@/services/apis/instance", () => ({
  openInstance: () => ({ execute: api.open, isLoading: ref(false) }),
  stopInstance: () => ({ execute: api.stop, isLoading: ref(false) }),
  restartInstance: () => ({ execute: api.restart, isLoading: ref(false) })
}));
vi.mock("@/services/apis/backup", () => ({
  backupDownloadAddress: () => ({ execute: api.download }),
  restoreBackup: () => ({ execute: api.restore }),
  deleteBackup: () => ({ execute: api.remove }),
  backupList: () => ({ execute: api.list }),
  getBackupConfig: () => ({ execute: async () => ref({ compress: true, exclusions: [] }) }),
  setBackupConfig: () => ({ execute: vi.fn() }),
  createBackup: () => ({ execute: vi.fn() }),
  backupTaskStatus: () => ({ execute: api.status })
}));
vi.mock("ant-design-vue", () => ({ message: { success: vi.fn(), loading: vi.fn() } }));

import InstanceLine from "@/widgets/instance/InstanceLine.vue";
import Backups from "@/widgets/instance/Backups.vue";
import { message } from "ant-design-vue";

const passthrough = defineComponent({
  setup(_, { slots }) {
    return () =>
      h(
        "div",
        Object.values(slots).flatMap((slot) => slot?.() || [])
      );
  }
});
const confirm = defineComponent({
  props: { title: String, disabled: Boolean },
  emits: ["confirm"],
  setup(props, { slots, emit }) {
    return () =>
      h("div", { "data-confirm": props.title }, [
        slots.default?.(),
        h(
          "button",
          { "data-approve": "", disabled: props.disabled, onClick: () => emit("confirm") },
          "approve"
        )
      ]);
  }
});
const stubs: Record<string, Component> = Object.fromEntries(
  [
    "a-row",
    "a-col",
    "a-space",
    "a-typography-title",
    "a-typography-text",
    "a-spin",
    "a-progress",
    "a-form",
    "a-form-item",
    "a-switch",
    "a-input-number",
    "a-input",
    "a-textarea",
    "a-tag",
    "a-empty",
    "a-pagination",
    "CardPanel",
    "BetweenMenus"
  ].map((name) => [name, passthrough])
);
stubs["a-button"] = buttonStub;
stubs["a-popconfirm"] = confirm;
const hosts: VueWrapper[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.eula.mockResolvedValue(true);
  api.download.mockResolvedValue(ref({ password: "one-time-token", addr: "fixture.test" }));
  api.restore.mockResolvedValue(ref({ taskId: "restore-task" }));
  api.status.mockResolvedValue(ref({ taskId: "restore-task", status: -1 }));
  api.remove.mockResolvedValue(ref(true));
});
afterEach(() => {
  hosts.splice(0).forEach((host) => host.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("projected instance rows keep real action targets", () => {
  it("starts and navigates duplicate UUIDs on their own daemons and refreshes raw IDs", async () => {
    const uuid = "same-instance-uuid";
    for (const daemonId of ["node-a", "node-b"]) {
      const inst = {
        instanceUuid: uuid,
        config: { type: "minecraft/java" },
        moreInfo: { isStopped: true }
      };
      const line = mount(InstanceLine, {
        props: {
          column: { key: "actions" },
          record: { key: JSON.stringify(["instance", daemonId, uuid]), daemonId, inst },
          targetInstanceInfo: inst as any,
          targetDaemonId: daemonId
        },
        global: { stubs }
      });
      hosts.push(line);
      await line.findAll("button")[0].trigger("click");
      await flushPromises();
      expect(api.open).toHaveBeenLastCalledWith({ params: { uuid, daemonId } });
      expect(api.eula).toHaveBeenLastCalledWith(uuid, daemonId);
      await line.findAll("button")[2].trigger("click");
      expect(api.push).toHaveBeenLastCalledWith({
        path: "/instances/terminal",
        query: { daemonId, instanceId: uuid }
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(line.emitted("refreshList")).toEqual([[daemonId, uuid]]);
    }
    expect(api.open).toHaveBeenCalledTimes(2);
  });
});

describe("backup presentation forwards exact storage identity to existing handlers", () => {
  it.each(["download", "restore", "remove"] as const)(
    "preserves the unknown archive name for %s",
    async (action) => {
      const record = { name: "legacy imported server.zip", size: 2048, time: 123456789 };
      api.list.mockResolvedValue(ref([record]));
      const opened = vi.spyOn(window, "open").mockReturnValue(null);
      const host = mount(Backups, {
        props: {
          card: {
            title: "Backups",
            meta: { daemonId: "node-b", instanceId: "raw-instance-uuid" }
          } as any
        },
        global: { stubs }
      });
      hosts.push(host);
      await flushPromises();
      expect(host.get(".backup-kind").text()).toBe("TXT_CODE_backup_kind_unknown");
      expect(host.get(".backup-filename").text()).toBe(record.name);
      if (action === "download") {
        await host.get(".backup-actions > button").trigger("click");
      } else {
        const prompt = host.get(
          `[data-confirm="TXT_CODE_backup_${action === "restore" ? "restore" : "delete"}_confirm"]`
        );
        await prompt.findAll("button")[0].trigger("click");
        expect(api[action]).not.toHaveBeenCalled();
        await prompt.get("[data-approve]").trigger("click");
      }
      await flushPromises();
      expect(api[action]).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining(
          action === "restore"
            ? {
                params: { daemonId: "node-b", uuid: "raw-instance-uuid" },
                data: { file_name: record.name }
              }
            : {
                params: { daemonId: "node-b", uuid: "raw-instance-uuid", file_name: record.name }
              }
        )
      );
      if (action === "restore") {
        expect(message.success).not.toHaveBeenCalledWith("TXT_CODE_backup_restore_done");
        expect(api.list).toHaveBeenCalledTimes(1);
      }
      if (action === "download") {
        expect(opened).toHaveBeenCalledExactlyOnceWith(
          `http://fixture.test/backup-download/one-time-token/${record.name}`
        );
      }
    }
  );
});
