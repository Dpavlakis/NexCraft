import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  tags: vi.fn(),
  delete: vi.fn(),
  info: vi.fn(),
  report: vi.fn(),
  success: vi.fn(),
  confirm: vi.fn(),
  batchDelete: vi.fn()
}));
const state = reactive({ isDesignMode: false });
vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/stores/useLayoutContainerStore", () => ({
  useLayoutContainerStore: () => ({ containerState: state })
}));
vi.mock("@/components/fc", () => ({
  openInstanceTagsEditor: api.tags,
  useDeleteInstanceDialog: api.delete
}));
vi.mock("@/services/apis/instance", () => ({
  getInstanceInfo: () => ({ execute: api.info }),
  batchDelete: () => ({ execute: api.batchDelete })
}));
vi.mock("@/tools/validator", () => ({ reportErrorMsg: api.report }));
vi.mock("ant-design-vue", () => ({
  message: { success: api.success },
  Modal: { confirm: api.confirm }
}));
import InstanceSecondaryActions from "@/components/InstanceSecondaryActions.vue";
import DeleteInstanceDialog from "@/widgets/instance/dialogs/DeleteInstanceDialog.vue";
const wrappers: VueWrapper[] = [];
const pass = defineComponent({
  setup(_, { slots }) {
    return () => h("div", [slots.default?.(), slots.footer?.()]);
  }
});
const stubs = {
  "a-tooltip": pass,
  "a-modal": pass,
  "a-checkbox": pass,
  "a-typography-paragraph": pass,
  "a-typography-text": pass,
  "a-button": defineComponent({
    props: ["disabled"],
    setup(props, { slots }) {
      return () => h("button", { disabled: props.disabled }, slots.default?.());
    }
  })
};
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await nextTick();
};
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function host(extra: Record<string, any> = {}) {
  const wrapper = mount(InstanceSecondaryActions, {
    props: { instanceId: "a", daemonId: "node-a", nickname: "Server A", tags: ["old"], ...extra },
    attachTo: document.body,
    global: { stubs }
  });
  wrappers.push(wrapper);
  return wrapper;
}
beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  state.isDesignMode = false;
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});

describe("shared production instance actions", () => {
  it("captures delete identity, emits only after true acknowledgement, and never mutates tags", async () => {
    const task = deferred();
    api.delete.mockReturnValue(task.promise);
    const wrapper = host();
    await wrapper.findAll("button")[1].trigger("click");
    expect(api.delete).toHaveBeenCalledExactlyOnceWith("a", "node-a", "Server A");
    expect(wrapper.emitted("deleted")).toBeUndefined();
    task.resolve(true);
    await flush();
    expect(wrapper.emitted("deleted")).toHaveLength(1);
    expect(wrapper.props("tags")).toEqual(["old"]);
  });
  it.each([false, undefined])(
    "does not emit after cancelled or missing delete result %s",
    async (result) => {
      api.delete.mockResolvedValue(result);
      const wrapper = host();
      await wrapper.findAll("button")[1].trigger("click");
      await flush();
      expect(wrapper.emitted("deleted")).toBeUndefined();
    }
  );
  it("rejects stale delete completion even across A → B → A", async () => {
    const task = deferred();
    api.delete.mockReturnValue(task.promise);
    const wrapper = host();
    await wrapper.findAll("button")[1].trigger("click");
    await wrapper.setProps({ instanceId: "b", daemonId: "node-b" });
    await wrapper.setProps({ instanceId: "a", daemonId: "node-a" });
    task.resolve(true);
    await flush();
    expect(wrapper.emitted("deleted")).toBeUndefined();
    expect(api.success).not.toHaveBeenCalled();
  });
  it("does not report a cancelled tag draft as saved", async () => {
    api.tags.mockResolvedValue(["draft"]);
    api.info.mockResolvedValue(ref({ instanceUuid: "a", config: { tag: ["old"] } }));
    const wrapper = host();
    await wrapper.findAll("button")[0].trigger("click");
    await flush();
    expect(api.info).toHaveBeenCalledWith({
      params: { uuid: "a", daemonId: "node-a" },
      forceRequest: true
    });
    expect(wrapper.emitted("changed")).toBeUndefined();
  });
  it("emits changed for authoritative saved tags and skips reads for an unchanged result", async () => {
    api.tags.mockResolvedValueOnce(["old"]).mockResolvedValueOnce(["saved"]);
    api.info.mockResolvedValue(ref({ instanceUuid: "a", config: { tag: ["saved"] } }));
    const wrapper = host();
    await wrapper.findAll("button")[0].trigger("click");
    await flush();
    expect(api.info).not.toHaveBeenCalled();
    await wrapper.findAll("button")[0].trigger("click");
    await flush();
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });
  it("guards stale tag verification, rejects wrong identity, and suppresses unmounted outcomes", async () => {
    const task = deferred();
    api.tags.mockResolvedValue(["saved"]);
    api.info.mockReturnValue(task.promise);
    const wrapper = host();
    await wrapper.findAll("button")[0].trigger("click");
    await flush();
    await wrapper.setProps({ daemonId: "node-b" });
    task.resolve(ref({ instanceUuid: "a", config: { tag: ["saved"] } }));
    await flush();
    expect(wrapper.emitted("changed")).toBeUndefined();
    api.info.mockResolvedValue(ref({ instanceUuid: "different", config: { tag: ["saved"] } }));
    await wrapper.findAll("button")[0].trigger("click");
    await flush();
    expect(wrapper.emitted("changed")).toBeUndefined();
    const deleted = deferred();
    api.delete.mockReturnValue(deleted.promise);
    await wrapper.findAll("button")[1].trigger("click");
    wrapper.unmount();
    deleted.resolve(true);
    await flush();
    expect(wrapper.emitted("deleted")).toBeUndefined();
  });
  it("keeps the ellipsis menu keyboard accessible and respects disabled/design mode", async () => {
    const wrapper = host({ menu: true });
    await wrapper.get("button").trigger("keydown", { key: "ArrowDown" });
    const items = wrapper.findAll('[role="menuitem"]');
    expect(document.activeElement).toBe(items[0].element);
    await items[0].trigger("keydown", { key: "End" });
    expect(document.activeElement).toBe(items[1].element);
    await items[1].trigger("keydown", { key: "Home" });
    expect(document.activeElement).toBe(items[0].element);
    await items[0].trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.get("button").element);
    await wrapper.setProps({ disabled: true });
    await wrapper.get("button").trigger("click");
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    await wrapper.setProps({ disabled: false });
    state.isDesignMode = true;
    await nextTick();
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    expect(api.tags).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });
  it("registers an outside listener only for menu presentation and cleans up when it changes or unmounts", async () => {
    const add = vi.spyOn(document, "addEventListener"),
      remove = vi.spyOn(document, "removeEventListener");
    const wrapper = host();
    expect(add.mock.calls.filter(([event]) => event === "pointerdown")).toHaveLength(0);
    await wrapper.setProps({ menu: true });
    const listener = add.mock.calls.find(([event]) => event === "pointerdown")![1];
    expect(add.mock.calls.filter(([event]) => event === "pointerdown")).toHaveLength(1);
    await wrapper.setProps({ menu: false });
    expect(remove).toHaveBeenCalledWith("pointerdown", listener);
    await wrapper.setProps({ menu: true });
    remove.mockClear();
    wrapper.unmount();
    expect(remove).toHaveBeenCalledExactlyOnceWith("pointerdown", listener);
  });
});

describe("native delete dialog choices", () => {
  function dialog() {
    const emitResult = vi.fn(),
      destroyComponent = vi.fn();
    const wrapper = mount(DeleteInstanceDialog, {
      props: {
        instanceId: "a",
        daemonId: "node-a",
        nickname: "Long named server",
        emitResult,
        destroyComponent
      },
      global: { stubs }
    });
    wrappers.push(wrapper);
    return { wrapper, emitResult, vm: (wrapper.vm as any).$.setupState };
  }
  it("shows the target, keeps files by default, and acknowledges only after success", async () => {
    const task = deferred();
    api.batchDelete.mockReturnValue(task.promise);
    const { wrapper, vm, emitResult } = dialog();
    expect(wrapper.text()).toContain("Long named server");
    expect(vm.deleteFiles).toBe(false);
    const pending = vm.onDelete();
    expect(api.confirm).not.toHaveBeenCalled();
    expect(emitResult).not.toHaveBeenCalled();
    expect(api.batchDelete).toHaveBeenCalledWith({
      params: { daemonId: "node-a" },
      data: { uuids: ["a"], deleteFile: false }
    });
    task.resolve(
      ref({
        instanceUuids: ["a"],
        instances: [{ instanceUuid: "a", nickname: "Long named server" }]
      })
    );
    await pending;
    expect(emitResult).toHaveBeenCalledWith(true);
  });
  it("uses the existing second confirmation only for files and captures its choice", async () => {
    api.batchDelete.mockResolvedValue(
      ref({
        instanceUuids: ["a"],
        instances: [{ instanceUuid: "a", nickname: "Long named server" }]
      })
    );
    const { wrapper, vm, emitResult } = dialog();
    vm.deleteFiles = true;
    await vm.onDelete();
    expect(api.batchDelete).not.toHaveBeenCalled();
    expect(api.confirm).toHaveBeenCalledOnce();
    await wrapper.setProps({ instanceId: "b", daemonId: "node-b", nickname: "Other server" });
    expect(wrapper.get(".delete-target").text()).toContain("Long named server");
    vm.deleteFiles = false;
    await api.confirm.mock.calls[0][0].onOk();
    expect(api.batchDelete).toHaveBeenCalledWith({
      params: { daemonId: "node-a" },
      data: { uuids: ["a"], deleteFile: true }
    });
    expect(emitResult).toHaveBeenCalledExactlyOnceWith(true);
  });
  it.each([
    ["empty confirmed list", { instanceUuids: ["a"], instances: [] }],
    [
      "different confirmed UUID",
      { instanceUuids: ["a"], instances: [{ instanceUuid: "b", nickname: "Other server" }] }
    ],
    ["request echo only", { instanceUuids: ["a"] }],
    ["missing response", undefined],
    ["null response", null],
    ["legacy true", true],
    ["legacy string array", ["a"]],
    ["malformed instances", { instanceUuids: ["a"], instances: { instanceUuid: "a" } }],
    ["malformed entries", { instanceUuids: ["a"], instances: [null, {}, { instanceUuid: 1 }] }]
  ])("reports an actionable error and false for %s", async (_label, result) => {
    api.batchDelete.mockResolvedValue(ref(result));
    const { vm, emitResult } = dialog();
    await vm.onDelete();
    expect(emitResult).toHaveBeenCalledExactlyOnceWith(false);
    expect(api.report).toHaveBeenCalledOnce();
    expect(api.report.mock.calls[0][0].message).toBe("TXT_CODE_server_delete_unconfirmed");
  });
  it("uses the captured target, including when a pending response confirms only a new prop target", async () => {
    const task = deferred();
    api.batchDelete.mockReturnValue(task.promise);
    const { wrapper, vm, emitResult } = dialog();
    const pending = vm.onDelete();
    await wrapper.setProps({ instanceId: "b", daemonId: "node-b", nickname: "Other server" });
    task.resolve(
      ref({ instanceUuids: ["a"], instances: [{ instanceUuid: "b", nickname: "Other server" }] })
    );
    await pending;
    expect(api.batchDelete).toHaveBeenCalledExactlyOnceWith({
      params: { daemonId: "node-a" },
      data: { uuids: ["a"], deleteFile: false }
    });
    expect(emitResult).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("does not report a completed deletion after the native dialog unmounts", async () => {
    const task = deferred();
    api.batchDelete.mockReturnValue(task.promise);
    const { wrapper, vm, emitResult } = dialog();
    const pending = vm.onDelete();
    wrapper.unmount();
    task.resolve(
      ref({
        instanceUuids: ["a"],
        instances: [{ instanceUuid: "a", nickname: "Long named server" }]
      })
    );
    await pending;
    expect(emitResult).not.toHaveBeenCalled();
    expect(api.report).not.toHaveBeenCalled();
  });
  it("does not delete from an abandoned file confirmation and reports failures as false", async () => {
    const { vm, emitResult } = dialog();
    vm.deleteFiles = true;
    await vm.onDelete();
    vm.onCancel();
    await api.confirm.mock.calls[0][0].onOk();
    expect(api.batchDelete).not.toHaveBeenCalled();
    expect(emitResult).toHaveBeenCalledExactlyOnceWith(false);
    const other = dialog();
    api.batchDelete.mockRejectedValue(new Error("denied"));
    await other.vm.onDelete();
    expect(other.emitResult).toHaveBeenCalledWith(false);
    expect(api.report.mock.calls[0][0].message).toBe("denied");
  });
});
