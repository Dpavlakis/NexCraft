import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("ant-design-vue", () => ({ message: {}, Modal: {} }));
vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/services/apis/instance", () => ({
  getInstanceInfo: () => ({
    execute: api.execute,
    state: ref(),
    isLoading: ref(false),
    isReady: ref(false)
  }),
  getConfigFile: vi.fn(),
  updateConfigFile: vi.fn()
}));
import { useInstanceInfo } from "@/hooks/useInstance";

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const hosts: VueWrapper[] = [];
const errors: unknown[] = [];
function host(autoRefresh = true) {
  const wrapper = mount(
    defineComponent({
      setup() {
        useInstanceInfo({ daemonId: "node-a", instanceId: "server-a", autoRefresh });
        return () => h("div");
      }
    }),
    { global: { config: { errorHandler: (error) => errors.push(error) } } }
  );
  hosts.push(wrapper);
  return wrapper;
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
beforeEach(() => {
  vi.useFakeTimers();
  api.execute.mockReset().mockResolvedValue(undefined);
  errors.length = 0;
});
afterEach(() => {
  hosts.splice(0).forEach((h) => h.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("instance polling lifecycle", () => {
  it("does not arm polling when the initial request succeeds after unmount", async () => {
    const pending = deferred();
    api.execute.mockReturnValueOnce(pending.promise);
    const wrapper = host();
    wrapper.unmount();
    pending.resolve();
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(9000);
    expect(api.execute).toHaveBeenCalledTimes(1);
  });
  it("keeps a late initial failure handled without allocating a timer", async () => {
    const pending = deferred();
    api.execute.mockReturnValueOnce(pending.promise);
    const wrapper = host();
    wrapper.unmount();
    const error = new Error("fetch failed");
    pending.reject(error);
    await flush();
    expect(errors).toEqual([error]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.execute).toHaveBeenCalledTimes(1);
  });
  it("polls the live target every three seconds and clears its timer on unmount", async () => {
    const wrapper = host();
    await flush();
    await vi.advanceTimersByTimeAsync(2999);
    expect(api.execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.execute).toHaveBeenCalledTimes(2);
    expect(api.execute).toHaveBeenLastCalledWith({
      params: { daemonId: "node-a", uuid: "server-a" }
    });
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.execute).toHaveBeenCalledTimes(2);
  });
  it("rejects a saved poll callback invoked after unmount", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const wrapper = host();
    await flush();
    const callback = interval.mock.calls[0][0] as () => Promise<void>;
    wrapper.unmount();
    await callback();
    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not poll when autoRefresh is false", async () => {
    host(false);
    await flush();
    await vi.advanceTimersByTimeAsync(9000);
    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
