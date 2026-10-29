import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { deferred, flushPromises, mountHook } from "./helpers";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  compress: vi.fn(),
  append: vi.fn()
}));
vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/components/fc", () => ({ openLoadingDialog: vi.fn(), useImageViewerDialog: vi.fn() }));
vi.mock("@/components/OverwriteFilesPopUpContent.vue", () => ({ default: {} }));
vi.mock("@/tools/validator", () => ({ reportErrorMsg: mocks.error }));
vi.mock("@/tools/folderUploader", () => ({
  compressFolder: mocks.compress,
  scanDirectory: vi.fn()
}));
vi.mock("@/tools/protocol", () => ({
  mapDaemonAddress: vi.fn(),
  parseForwardAddress: () => "https://daemon"
}));
vi.mock("@ant-design/icons-vue", () => ({ ExclamationCircleOutlined: {} }));
vi.mock("ant-design-vue", () => ({
  message: { success: mocks.success, warning: vi.fn(), error: vi.fn(), loading: vi.fn() },
  Modal: {}
}));
vi.mock("@/services/uploadService", () => ({ default: { append: mocks.append } }));
vi.mock("@/services/apis/fileManager", () => ({
  fileList: () => ({ execute: mocks.list }),
  uploadAddress: () => ({ execute: async () => ref({ addr: "daemon", password: "passport" }) })
}));
import { useFileManager } from "@/hooks/useFileManager";

type Pending = { params: any; task: ReturnType<typeof deferred<any>> };
let requests: Pending[];
let hosts: ReturnType<typeof mountHook<ReturnType<typeof useFileManager>>>[];
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  requests = [];
  hosts = [];
  mocks.list.mockImplementation(({ params }) => {
    const task = deferred<any>();
    requests.push({ params, task });
    return task.promise;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  hosts.forEach((host) => host.unmount());
  localStorage.clear();
  vi.restoreAllMocks();
});

function manager(withTabs = true) {
  const host = mountHook(() => useFileManager("instance", "daemon"));
  hosts.push(host);
  const fm = host.result;
  if (withTabs) {
    fm.tabList.value[fm.currentTabKey] = [
      { key: "a", path: "/a", name: "a", closable: false, pushedTime: 0 },
      { key: "b", path: "/b", name: "b", closable: true, pushedTime: 0 }
    ];
    fm.activeTab.value = "a";
    fm.breadcrumbs.splice(0, fm.breadcrumbs.length, { path: "/a", name: "a", disabled: false });
  }
  return { fm, host };
}
function resolve(index: number, name: string, total = index + 10) {
  requests[index].task.resolve(ref({ items: [{ name, type: 1 }], total }));
}

describe("listing generations", () => {
  it.each(["resolve", "reject"])(
    "ignores drive-navigation %s after a tab switch",
    async (settle) => {
      const { fm } = manager();
      const disk = fm.toDisk("D"),
        current = fm.handleChangeTab("b");
      if (settle === "resolve") resolve(0, "old-drive");
      else requests[0].task.reject(new Error("old-drive"));
      await disk;
      expect(fm.currentPath.value).toBe("/b/");
      expect(fm.spinning.value).toBe(true);
      expect(mocks.error).not.toHaveBeenCalled();
      resolve(1, "B");
      await current;
      expect(fm.spinning.value).toBe(false);
    }
  );
  it("rejects an A-B-A directory failure without rolling back the current A", async () => {
    const { fm } = manager();
    const old = fm.handleChangeDir("/a"),
      b = fm.handleChangeTab("b"),
      current = fm.handleChangeTab("a");
    requests[0].task.reject(new Error("obsolete A"));
    await old;
    expect(requests).toHaveLength(3);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(fm.currentPath.value).toBe("/a/");
    expect(fm.spinning.value).toBe(true);
    resolve(1, "old B");
    await b;
    resolve(2, "new A");
    await current;
    expect(fm.dataSource.value?.[0].name).toBe("new A");
  });
  it("keeps B items, totals and breadcrumbs when A resolves last", async () => {
    const { fm } = manager();
    const a = fm.handleChangeTab("a"),
      b = fm.handleChangeTab("b");
    resolve(1, "B", 22);
    await b;
    resolve(0, "A", 11);
    await a;
    expect(fm.dataSource.value?.[0].name).toBe("B");
    expect(fm.operationForm.value.total).toBe(22);
    expect(fm.activeTab.value).toBe("b");
    expect(fm.currentPath.value).toBe("/b/");
  });
  it("uses generation for A-B-A even when the original context matches again", async () => {
    const { fm } = manager();
    const a1 = fm.handleChangeTab("a"),
      b = fm.handleChangeTab("b"),
      a2 = fm.handleChangeTab("a");
    resolve(2, "A-new");
    await a2;
    resolve(1, "B-old");
    await b;
    resolve(0, "A-old");
    await a1;
    expect(fm.dataSource.value?.[0].name).toBe("A-new");
  });
  it("uses generation for identical refreshes and suppresses a stale refresh toast", async () => {
    const { fm } = manager();
    const old = fm.reloadList(),
      current = fm.getFileList();
    resolve(1, "new");
    await current;
    resolve(0, "old");
    await old;
    expect(fm.dataSource.value?.[0].name).toBe("new");
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("does not clear B's loading when A settles first", async () => {
    const { fm } = manager();
    const a = fm.handleChangeTab("a"),
      b = fm.handleChangeTab("b");
    resolve(0, "old");
    await a;
    expect(fm.spinning.value).toBe(true);
    resolve(1, "new");
    await b;
    expect(fm.spinning.value).toBe(false);
  });
  it.each(["resolve", "reject"])("ignores directory %s after switching tabs", async (settle) => {
    const { fm } = manager();
    const old = fm.handleChangeDir("/new-dir"),
      current = fm.handleChangeTab("b");
    if (settle === "resolve") resolve(0, "old");
    else requests[0].task.reject(new Error("obsolete"));
    await flushPromises();
    expect(requests).toHaveLength(2);
    expect(fm.currentPath.value).toBe("/b/");
    expect(fm.currentTabs.value[0]).toMatchObject({ path: "/a", name: "a" });
    expect(fm.currentTabs.value[1].path).toBe("/b");
    expect(fm.spinning.value).toBe(true);
    expect(mocks.error).not.toHaveBeenCalled();
    resolve(1, "B");
    await current;
    await old;
    expect(fm.dataSource.value?.[0].name).toBe("B");
    expect(fm.spinning.value).toBe(false);
  });
  it("cannot commit after the pending tab is closed", async () => {
    const { fm } = manager();
    const old = fm.handleChangeDir("/closed");
    fm.onEditTabs("a", "remove");
    resolve(1, "B");
    await flushPromises();
    resolve(0, "closed");
    await old;
    expect(fm.currentTabs.value.map((tab) => tab.key)).toEqual(["b"]);
    expect(fm.currentTabs.value[0].path).toBe("/b");
    expect(fm.dataSource.value?.[0].name).toBe("B");
  });
  it("fences search and pagination with the full request context", async () => {
    const { fm } = manager();
    const old = fm.getFileList();
    fm.operationForm.value.name = "needle";
    fm.handleSearchChange();
    fm.handleTableChange({ current: 3, pageSize: 20 });
    expect(requests[2].params).toMatchObject({
      daemonId: "daemon",
      uuid: "instance",
      target: "/a/",
      file_name: "needle",
      page: 2,
      page_size: 20
    });
    resolve(2, "page-3", 60);
    await flushPromises();
    resolve(1, "search-old", 30);
    resolve(0, "page-old", 10);
    await old;
    await flushPromises();
    expect(fm.dataSource.value?.[0].name).toBe("page-3");
    expect(fm.operationForm.value.total).toBe(60);
  });
  it("rejects a changed context even before another request starts", async () => {
    const { fm } = manager();
    const old = fm.getFileList();
    fm.operationForm.value.name = "not-submitted";
    resolve(0, "old");
    await old;
    expect(fm.dataSource.value).toBeUndefined();
    expect(fm.operationForm.value.total).toBe(0);
  });
  it.each(["resolve", "reject"])("ignores listing %s after unmount", async (settle) => {
    const { fm, host } = manager(false);
    const old = fm.getFileList(true);
    host.unmount();
    if (settle === "resolve") resolve(0, "disposed");
    else requests[0].task.reject(new Error("disposed"));
    await old;
    expect(fm.dataSource.value).toBeUndefined();
    expect(fm.currentTabs.value).toHaveLength(0);
    expect(requests).toHaveLength(1);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(host.errors).toHaveLength(0);
  });
  it.each(["resolve", "reject"])("fences row navigation %s after tab switch", async (settle) => {
    const { fm } = manager();
    const old = fm.rowClickTable("child", 0),
      current = fm.handleChangeTab("b");
    if (settle === "resolve") resolve(0, "old");
    else requests[0].task.reject(new Error("old"));
    await old;
    expect(fm.currentPath.value).toBe("/b/");
    expect(fm.currentTabs.value[0]).toMatchObject({ path: "/a", name: "a" });
    expect(fm.currentTabs.value[1].path).toBe("/b");
    expect(fm.spinning.value).toBe(true);
    expect(mocks.error).not.toHaveBeenCalled();
    resolve(1, "B");
    await current;
  });
});

describe("active navigation controls", () => {
  it("restores breadcrumbs and reports a current row-navigation failure", async () => {
    const { fm } = manager();
    const current = fm.rowClickTable("child", 0);
    requests[0].task.reject(new Error("child denied"));
    await current;
    expect(fm.currentPath.value).toBe("/a/");
    expect(fm.currentTabs.value[0].path).toBe("/a");
    expect(mocks.error).toHaveBeenCalledWith("child denied");
    expect(fm.spinning.value).toBe(false);
  });
  it.each(["listing first", "upload first"])(
    "preserves simultaneous folder-upload loading: %s",
    async (order) => {
      const { fm } = manager();
      const compressed = deferred<Uint8Array>();
      mocks.compress.mockReturnValue(compressed.promise);
      const upload = fm.handleFolderUpload(
        [{ file: new File(["data"], "child") }] as any,
        "folder"
      );
      requests[0].task.resolve(ref({ items: [], total: 0 }));
      await flushPromises();
      const listing = fm.handleChangeTab("b");
      if (order === "listing first") {
        resolve(1, "B");
        await listing;
        expect(fm.spinning.value).toBe(true);
        compressed.resolve(new Uint8Array([1]));
        await upload;
      } else {
        compressed.resolve(new Uint8Array([1]));
        await upload;
        expect(fm.spinning.value).toBe(true);
        resolve(1, "B");
        await listing;
      }
      expect(mocks.append).toHaveBeenCalledTimes(1);
      expect(fm.spinning.value).toBe(false);
    }
  );
  it("updates the original tab on a successful directory change", async () => {
    const { fm } = manager();
    const jump = fm.handleChangeDir("/a/child");
    resolve(0, "child");
    await jump;
    expect(fm.currentTabs.value[0]).toMatchObject({ name: "child", path: "/a/child" });
    expect(fm.currentPath.value).toBe("/a/child/");
    expect(fm.spinning.value).toBe(false);
  });
  it("restores the current failed directory and reports its error after rollback", async () => {
    const { fm } = manager();
    const jump = fm.handleChangeDir("/invalid");
    requests[0].task.reject(new Error("denied"));
    await flushPromises();
    expect(requests).toHaveLength(2);
    expect(requests[1].params.target).toBe("/a/");
    resolve(1, "restored");
    await jump;
    expect(fm.currentPath.value).toBe("/a/");
    expect(fm.dataSource.value?.[0].name).toBe("restored");
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.error.mock.calls[0][0]).toContain("denied");
    expect(fm.spinning.value).toBe(false);
  });
  it("suppresses an active error if its rollback becomes stale", async () => {
    const { fm } = manager();
    const jump = fm.handleChangeDir("/invalid");
    requests[0].task.reject(new Error("denied"));
    await flushPromises();
    const current = fm.handleChangeTab("b");
    resolve(1, "rollback");
    await jump;
    expect(mocks.error).not.toHaveBeenCalled();
    expect(fm.spinning.value).toBe(true);
    resolve(2, "B");
    await current;
  });
  it.each([
    ["directory", "resolve", "navigation first"],
    ["directory", "reject", "navigation first"],
    ["directory", "resolve", "search first"],
    ["directory", "reject", "search first"],
    ["row", "resolve", "navigation first"],
    ["row", "reject", "navigation first"],
    ["row", "resolve", "search first"],
    ["row", "reject", "search first"]
  ])("transfers %s metadata to search with stale %s, %s", async (navigation, settle, order) => {
    const { fm } = manager();
    const path = navigation === "directory" ? "/child" : "/a/child";
    const jump =
      navigation === "directory" ? fm.handleChangeDir(path) : fm.rowClickTable("child", 0);
    fm.operationForm.value.name = "search";
    fm.handleSearchChange();
    expect(requests[1].params).toMatchObject({ target: path + "/", file_name: "search" });
    expect(fm.currentTabs.value[0]).toMatchObject({ path: "/a", name: "a" });
    const settleNavigation = async () => {
      if (settle === "resolve") resolve(0, "old");
      else requests[0].task.reject(new Error("obsolete navigation"));
      await jump;
    };
    if (order === "navigation first") {
      await settleNavigation();
      expect(fm.spinning.value).toBe(true);
      expect(fm.currentTabs.value[0]).toMatchObject({ path: "/a", name: "a" });
      resolve(1, "search", 42);
      await flushPromises();
    } else {
      resolve(1, "search", 42);
      await flushPromises();
      await settleNavigation();
    }
    expect(requests).toHaveLength(2);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(fm.currentPath.value).toBe(path + "/");
    expect(fm.currentTabs.value[0]).toMatchObject({ path, name: "child" });
    expect(fm.dataSource.value?.[0].name).toBe("search");
    expect(fm.operationForm.value.total).toBe(42);
    expect(fm.spinning.value).toBe(false);
    expect(localStorage.getItem("FileManagerTabMap")).toContain(path);
    const away = fm.handleChangeTab("b");
    resolve(2, "B");
    await away;
    const back = fm.handleChangeTab("a");
    expect(requests[3].params.target).toBe(path + "/");
    resolve(3, "child-again");
    await back;
    expect(fm.currentPath.value).toBe(path + "/");
    expect(fm.spinning.value).toBe(false);
  });
  it.each(["directory", "row"])(
    "drops pending %s metadata across A-B-A search",
    async (navigation) => {
      const { fm } = manager();
      const jump =
        navigation === "directory" ? fm.handleChangeDir("/child") : fm.rowClickTable("child", 0);
      const b = fm.handleChangeTab("b"),
        a = fm.handleChangeTab("a");
      fm.operationForm.value.name = "search";
      fm.handleSearchChange();
      expect(requests[3].params.target).toBe("/a/");
      requests[0].task.reject(new Error("obsolete child"));
      await jump;
      resolve(1, "old B");
      resolve(2, "old A");
      await Promise.all([b, a]);
      expect(fm.spinning.value).toBe(true);
      resolve(3, "A search");
      await flushPromises();
      expect(fm.currentTabs.value[0]).toMatchObject({ path: "/a", name: "a" });
      expect(fm.currentPath.value).toBe("/a/");
      expect(fm.dataSource.value?.[0].name).toBe("A search");
      expect(mocks.error).not.toHaveBeenCalled();
      expect(fm.spinning.value).toBe(false);
      expect(requests).toHaveLength(4);
    }
  );
  it.each([
    ["directory", "resolve"],
    ["directory", "reject"],
    ["row", "resolve"],
    ["row", "reject"]
  ])(
    "does not commit %s metadata after search fails and stale navigation %s",
    async (navigation, settle) => {
      const { fm } = manager();
      const path = navigation === "directory" ? "/child" : "/a/child";
      const jump =
        navigation === "directory" ? fm.handleChangeDir(path) : fm.rowClickTable("child", 0);
      fm.operationForm.value.name = "search";
      fm.handleSearchChange();
      requests[1].task.reject(new Error("search denied"));
      await flushPromises();
      if (settle === "resolve") resolve(0, "obsolete child");
      else requests[0].task.reject(new Error("obsolete child"));
      await jump;
      expect(fm.currentTabs.value[0]).toMatchObject({ path: "/a", name: "a" });
      expect(fm.currentPath.value).toBe(path + "/");
      expect(fm.dataSource.value).toBeUndefined();
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith("search denied");
      expect(fm.spinning.value).toBe(false);
      expect(requests).toHaveLength(2);
    }
  );
  it("keeps Windows drive request formatting and tab persistence", async () => {
    const { fm } = manager();
    const disk = fm.toDisk("D");
    expect(requests[0].params.target).toBe("D:\\/");
    resolve(0, "drive");
    await disk;
    expect(fm.currentTabs.value[0].path).toBe("D:\\");
    expect(fm.spinning.value).toBe(false);
    const tab = fm.handleChangeTab("a");
    expect(requests[1].params.target).toBe("D:/");
    resolve(1, "drive-again");
    await tab;
    await flushPromises();
    expect(localStorage.getItem("FileManagerTabMap")).toContain("D:");
  });
  it("creates one default tab for the winning initial listing", async () => {
    const { fm } = manager(false);
    const old = fm.getFileList(false, "/initial"),
      current = fm.getFileList(false, "/initial");
    resolve(1, "initial");
    await current;
    resolve(0, "obsolete");
    await old;
    if (requests[2]) {
      resolve(2, "initial");
      await flushPromises();
    }
    expect(fm.currentTabs.value).toHaveLength(1);
    expect(fm.currentTabs.value[0].path).toBe("/initial");
    expect(fm.dataSource.value?.[0].name).toBe("initial");
  });
  it("keeps throwErr behavior for a current listing failure", async () => {
    const { fm } = manager();
    const current = fm.getFileList(true);
    requests[0].task.reject(new Error("current"));
    await expect(current).rejects.toThrow("current");
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
