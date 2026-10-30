import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { deferred, flushPromises } from "./helpers";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  piece: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  factoryError: false
}));
vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/tools/validator", () => ({ reportErrorMsg: mocks.error }));
vi.mock("ant-design-vue", () => ({ message: { error: vi.fn(), success: mocks.success } }));
vi.mock("@/services/apis/fileManager", () => ({
  uploadFile: () => {
    if (mocks.factoryError) throw new Error("setup failed");
    const state = ref();
    return {
      state,
      execute: async (options: any) => {
        state.value = await mocks.init(options);
      }
    };
  },
  uploadFilePiece: () => ({ execute: mocks.piece })
}));
import uploadService from "@/services/uploadService";

const pieceSize = 2 * 1024 * 1024;
const options = { overwrite: true, unzip: true, deleteAfterUnzip: true, code: "utf-8" };
const append = (name: string, end = vi.fn(), size = 8) =>
  uploadService.append(
    new File([new Uint8Array(size)], name),
    "https://daemon/prefix",
    "passport",
    options,
    (entry) => entry.addCallback("end", end)
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.clearAllMocks();
  mocks.init.mockReset();
  mocks.piece.mockReset();
  mocks.factoryError = false;
  mocks.piece.mockImplementation(() => deferred().promise);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  mocks.init.mockResolvedValue({});
  await uploadService.stop();
  uploadService.uploaded = 0;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("upload initialization ownership", () => {
  it("cleans synchronous setup errors after observers are registered", async () => {
    mocks.factoryError = true;
    const end = vi.fn();
    append("sync-error", end);
    await flushPromises();
    expect(end).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(uploadService.files.size).toBe(0);
    expect(uploadService.status).toBe("stopped");
    mocks.factoryError = false;
  });
  it("cancels before setup starts without a request or a late callback", async () => {
    const end = vi.fn();
    append("cancelled", end);
    await uploadService.stop();
    await flushPromises();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.piece).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
  });
  it.each(["reject", "missing ID"])(
    "advances prepared B after A's %s and ends A once",
    async (failure) => {
      const a = deferred<any>(),
        b = deferred<any>();
      mocks.init.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);
      const end = vi.fn();
      append("A", end);
      vi.setSystemTime(1001);
      append("B");
      b.resolve({ id: "server-B", received: [] });
      await flushPromises();
      expect(mocks.piece).not.toHaveBeenCalled();
      if (failure === "reject") a.reject(new Error("init failed"));
      else a.resolve({ received: [] });
      await flushPromises();
      expect(end).toHaveBeenCalledTimes(1);
      expect(mocks.error).toHaveBeenCalledTimes(1);
      expect(uploadService.files.size).toBe(1);
      expect(uploadService.current).toBe("server-B");
      expect(mocks.piece).toHaveBeenCalledTimes(1);
      expect(uploadService.uploaded).toBe(0);
      expect(mocks.success).not.toHaveBeenCalled();
    }
  );
  it("keeps separate entries queued in the same clock tick", async () => {
    const a = deferred<any>(),
      b = deferred<any>();
    mocks.init.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);
    append("A");
    append("B");
    expect(uploadService.files.size).toBe(2);
    a.reject(new Error("A failed"));
    b.resolve({ id: "B", received: [] });
    await flushPromises();
    expect(mocks.piece).toHaveBeenCalledTimes(1);
    expect(uploadService.current).toBe("B");
  });
  it("removes a failed waiting entry without disturbing active chunks", async () => {
    const b = deferred<any>();
    mocks.init
      .mockResolvedValueOnce({ id: "A", received: [] })
      .mockImplementationOnce(() => b.promise);
    append("A");
    await flushPromises();
    vi.setSystemTime(1001);
    const end = vi.fn();
    append("B", end);
    const active = uploadService.task[0];
    b.reject(new Error("B failed"));
    await flushPromises();
    expect(uploadService.files.size).toBe(1);
    expect(uploadService.current).toBe("A");
    expect(uploadService.task[0]).toBe(active);
    expect(active?.status).toBe("uploading");
    expect(end).toHaveBeenCalledTimes(1);
    expect(mocks.piece).toHaveBeenCalledTimes(1);
  });
  it("stops cleanly when every initialization fails", async () => {
    const a = deferred<any>(),
      b = deferred<any>();
    mocks.init.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);
    const endA = vi.fn(),
      endB = vi.fn();
    append("A", endA);
    vi.setSystemTime(1001);
    append("B", endB);
    b.reject(new Error("B"));
    a.reject(new Error("A"));
    await flushPromises();
    expect(uploadService.files.size).toBe(0);
    expect(uploadService.current).toBeUndefined();
    expect(uploadService.status).toBe("stopped");
    expect(endA).toHaveBeenCalledTimes(1);
    expect(endB).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenCalledTimes(2);
  });
  it.each(["resolve", "reject"])(
    "ignores old initialization %s after stop and a new queue",
    async (settle) => {
      const old = deferred<any>();
      mocks.init.mockImplementationOnce(() => old.promise);
      const end = vi.fn();
      append("old", end);
      await flushPromises();
      await uploadService.stop();
      mocks.init.mockResolvedValue({ id: "new", received: [] });
      append("new");
      await flushPromises();
      if (settle === "resolve") old.resolve({ id: "old-server", received: [] });
      else old.reject(new Error("late failure"));
      await flushPromises();
      expect(end).toHaveBeenCalledTimes(1);
      expect(uploadService.current).toBe("new");
      expect([...uploadService.files.keys()]).toEqual(["new"]);
      expect(mocks.piece).toHaveBeenCalledTimes(1);
      expect(mocks.error).not.toHaveBeenCalled();
    }
  );
  it("finishing an old stop request cannot clear a new queue", async () => {
    const stop = deferred<any>();
    mocks.init.mockResolvedValueOnce({ id: "old", received: [] });
    append("old");
    await flushPromises();
    mocks.init.mockImplementationOnce(() => stop.promise);
    const stopping = uploadService.stop();
    mocks.init.mockResolvedValue({ id: "new", received: [] });
    append("new");
    await flushPromises();
    stop.resolve({});
    await stopping;
    expect(uploadService.current).toBe("new");
    expect([...uploadService.files.keys()]).toEqual(["new"]);
  });
});

describe("working uploads", () => {
  it("retains options, prefix URL, resume offset and multi-chunk completion", async () => {
    const chunks: ReturnType<typeof deferred<void>>[] = [];
    mocks.init.mockResolvedValue({ id: "upload", received: [{ start: 0, end: pieceSize }] });
    mocks.piece.mockImplementation(() => {
      const chunk = deferred();
      chunks.push(chunk);
      return chunk.promise;
    });
    const end = vi.fn();
    append("archive.zip", end, pieceSize * 3 + 2);
    await flushPromises();
    expect(mocks.init.mock.calls[0][0]).toMatchObject({
      url: "https://daemon/prefix/upload-new/passport",
      timeout: Number.MAX_VALUE,
      params: { filename: "archive.zip", size: pieceSize * 3 + 2, sum: "", ...options }
    });
    expect(mocks.piece.mock.calls.map(([r]) => r.params.offset)).toEqual([
      pieceSize,
      pieceSize * 2,
      pieceSize * 3
    ]);
    expect(
      mocks.piece.mock.calls.every(([r]) => r.url === "https://daemon/prefix/upload-piece/upload")
    ).toBe(true);
    chunks.forEach((chunk) => chunk.resolve());
    await flushPromises();
    expect(uploadService.uploaded).toBe(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(uploadService.status).toBe("stopped");
  });
  it("aborts paused chunks, resumes them and retains the retry limit", async () => {
    mocks.init.mockResolvedValue({ id: "upload", received: [] });
    const first = deferred();
    mocks.piece.mockImplementationOnce(() => first.promise).mockRejectedValue(new Error("offline"));
    append("archive");
    await flushPromises();
    const signal = mocks.piece.mock.calls[0][0].signal as AbortSignal;
    uploadService.suspend();
    expect(signal.aborted).toBe(true);
    first.reject(new Error("aborted"));
    await flushPromises();
    expect(uploadService.status).toBe("suspend");
    uploadService.unsuspend();
    await flushPromises();
    expect(mocks.piece).toHaveBeenCalledTimes(4);
    expect(uploadService.status).toBe("suspend");
    expect(uploadService.uploaded).toBe(0);
  });
});
