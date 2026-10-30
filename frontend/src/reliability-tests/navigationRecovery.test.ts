import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, onMounted } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  state: { userInfo: { token: "" } },
  cards: {} as Record<string, any>
}));
vi.mock("@/stores/useAppStateStore", () => ({
  useAppStateStore: () => ({ state: fixtures.state })
}));
vi.mock("@/tools/validator", () => ({ reportErrorMsg: vi.fn() }));
vi.mock("@/config/index", () => ({ LAYOUT_CARD_TYPES: fixtures.cards }));
import { apiService } from "@/services/apiService";
import { getInstanceInfo, setUpTerminalStreamChannel } from "@/services/apis/instance";
import { useInstanceVersions } from "@/hooks/useInstanceVersions";
import LayoutCard from "@/components/LayoutCard.vue";

let sequence = 0;
const wrappers: VueWrapper[] = [];
const adapter = vi.fn();
function packet(config: InternalAxiosRequestConfig, data: any = true) {
  return { status: 200, statusText: "OK", headers: {}, config, data: { status: 200, data } };
}
function limit(config: InternalAxiosRequestConfig, seconds: any = "1", status = 429) {
  return new AxiosError("limited", "ERR_BAD_RESPONSE", config, undefined, {
    status,
    statusText: "Limited",
    config,
    headers: { "retry-after": seconds },
    data: { status, data: "Too many requests, please try again later" }
  });
}
const read = (options: any = {}) =>
  apiService.subscribe({ url: "/api/instance", method: "GET", ...options });
beforeEach(() => {
  vi.useFakeTimers();
  fixtures.state.userInfo.token = "navigation-fixture-" + ++sequence;
  axios.defaults.adapter = adapter;
  adapter.mockReset();
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("bounded navigation read recovery through the actual API service", () => {
  it("coalesces concurrent detail reads through one cooldown and caches only recovered success", async () => {
    adapter
      .mockImplementationOnce(async (config) => {
        throw limit(config);
      })
      .mockImplementation(async (config) => packet(config, { instanceUuid: "target" }));
    const first = read(),
      second = read();
    await vi.advanceTimersByTimeAsync(999);
    expect(adapter).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(101);
    expect(await first).toEqual({ instanceUuid: "target" });
    expect(await second).toEqual({ instanceUuid: "target" });
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(await read()).toEqual({ instanceUuid: "target" });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it("rejects an aborted cache-hit caller without discarding the successful cache", async () => {
    adapter.mockImplementation(async (config) => packet(config, { instanceUuid: "cached" }));
    const first = read();
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toEqual({ instanceUuid: "cached" });
    const controller = new AbortController();
    controller.abort();
    await expect(read({ signal: controller.signal })).rejects.toThrow("Request cancelled");
    expect(await read()).toEqual({ instanceUuid: "cached" });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("fences an aborted coalesced caller independently from its live peer", async () => {
    adapter.mockImplementation(async (config) => packet(config, { instanceUuid: "shared" }));
    const first = read();
    const controller = new AbortController();
    const second = read({ signal: controller.signal }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(99);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);
    expect(await first).toEqual({ instanceUuid: "shared" });
    expect(await second).toBeInstanceOf(Error);
    expect(((await second) as Error).message).toContain("Request cancelled");
    expect(await read()).toEqual({ instanceUuid: "shared" });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["first", "before HTTP dispatch"],
    ["joined", "before HTTP dispatch"],
    ["first", "held HTTP"],
    ["joined", "held HTTP"],
    ["first", "publication delay"],
    ["joined", "publication delay"]
  ])("isolates the %s subscriber's abort during %s", async (caller, phase) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    adapter.mockImplementation(async (config) => {
      if (phase === "held HTTP") await held;
      return packet(config, { instanceUuid: "live-peer" });
    });
    const firstController = new AbortController();
    const joinedController = new AbortController();
    const firstApi = getInstanceInfo();
    const joinedApi = getInstanceInfo();
    const params = { uuid: "cancellation-owner", daemonId: "fixture" };
    const first = firstApi
      .execute({ params, signal: firstController.signal })
      .catch((error) => error);
    const joined = joinedApi
      .execute({ params, signal: joinedController.signal })
      .catch((error) => error);
    if (phase !== "before HTTP dispatch")
      await vi.advanceTimersByTimeAsync(phase === "held HTTP" ? 0 : 99);
    const transportSignal = ([...(apiService as any).pending.values()][0] as any).controller.signal;
    (caller === "first" ? firstController : joinedController).abort();
    release();
    await vi.advanceTimersByTimeAsync(100);
    const cancelled = await (caller === "first" ? first : joined);
    const live = await (caller === "first" ? joined : first);
    expect(cancelled).toBeInstanceOf(Error);
    expect(cancelled.message).toContain("Request cancelled");
    expect(live.value?.instanceUuid).toBe("live-peer");
    expect((caller === "first" ? firstApi : joinedApi).state.value).toBeUndefined();
    expect(transportSignal.aborted).toBe(false);
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it.each(["held HTTP", "publication delay", "retry wait"])(
    "retires all-cancelled %s resources without poisoning an identical replacement",
    async (phase) => {
      let releaseOld!: () => void;
      let releaseNew!: () => void;
      const oldGate = new Promise<void>((resolve) => {
        releaseOld = resolve;
      });
      const newGate = new Promise<void>((resolve) => {
        releaseNew = resolve;
      });
      adapter
        .mockImplementationOnce(async (config) => {
          if (phase === "retry wait") throw limit(config);
          if (phase === "held HTTP") await oldGate;
          return packet(config, { instanceUuid: "obsolete" });
        })
        .mockImplementation(async (config) => {
          await newGate;
          return packet(config, { instanceUuid: "replacement" });
        });
      const firstController = new AbortController();
      const joinedController = new AbortController();
      const firstRemoved = vi.spyOn(firstController.signal, "removeEventListener");
      const joinedRemoved = vi.spyOn(joinedController.signal, "removeEventListener");
      const first = read({ signal: firstController.signal }).catch((error) => error);
      const joined = read({ signal: joinedController.signal }).catch((error) => error);
      await vi.advanceTimersByTimeAsync(phase === "publication delay" ? 99 : 0);
      const oldGeneration = [...(apiService as any).pending.values()][0] as any;
      firstController.abort();
      expect(oldGeneration.controller.signal.aborted).toBe(false);
      joinedController.abort();
      expect(oldGeneration.controller.signal.aborted).toBe(true);
      expect(oldGeneration.event.listenerCount("response")).toBe(0);
      expect((apiService as any).pending.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(firstRemoved).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(joinedRemoved).toHaveBeenCalledWith("abort", expect.any(Function));
      const freshApi = getInstanceInfo();
      const fresh = freshApi.execute().catch((error) => error);
      // Start synchronously, before the old wait rejection/catch can run.
      expect(await first).toBeInstanceOf(Error);
      expect(await joined).toBeInstanceOf(Error);
      // The old adapter/catch settles while the replacement is still pending.
      releaseOld();
      await vi.advanceTimersByTimeAsync(0);
      expect(adapter).toHaveBeenCalledTimes(2);
      expect(freshApi.state.value).toBeUndefined();
      expect((apiService as any).pending.size).toBe(1);
      releaseNew();
      await vi.advanceTimersByTimeAsync(100);
      expect((await fresh).value?.instanceUuid).toBe("replacement");
      expect(await read()).toEqual({ instanceUuid: "replacement" });
      expect((apiService as any).pending.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(adapter).toHaveBeenCalledTimes(2);
    }
  );

  it("keeps a live peer's bounded recovery after the first subscriber cancels", async () => {
    adapter
      .mockImplementationOnce(async (config) => {
        throw limit(config, "2");
      })
      .mockImplementation(async (config) => packet(config, { instanceUuid: "recovered-peer" }));
    const controller = new AbortController();
    const cancelled = read({ signal: controller.signal }).catch((error) => error);
    const peer = read();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await cancelled).toBeInstanceOf(Error);
    expect(adapter.mock.calls[0][0].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1999);
    expect(adapter).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await peer).toEqual({ instanceUuid: "recovered-peer" });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it.each(["held HTTP", "publication delay", "retry wait"])(
    "fences every subscriber and cache across a session change during %s",
    async (phase) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      adapter
        .mockImplementationOnce(async (config) => {
          if (phase === "retry wait") throw limit(config);
          if (phase === "held HTTP") await held;
          return packet(config, { instanceUuid: "old-session" });
        })
        .mockImplementation(async (config) => packet(config, { instanceUuid: "fresh-session" }));
      const originalToken = fixtures.state.userInfo.token;
      const firstApi = getInstanceInfo();
      const joinedApi = getInstanceInfo();
      const first = firstApi.execute().catch((error) => error);
      const joined = joinedApi.execute().catch((error) => error);
      await vi.advanceTimersByTimeAsync(phase === "publication delay" ? 99 : 0);
      fixtures.state.userInfo.token = "rotated-" + originalToken;
      const fresh = read();
      release();
      await vi.advanceTimersByTimeAsync(1100);
      expect(await first).toBeInstanceOf(Error);
      expect(await joined).toBeInstanceOf(Error);
      expect(firstApi.state.value).toBeUndefined();
      expect(joinedApi.state.value).toBeUndefined();
      expect(await fresh).toEqual({ instanceUuid: "fresh-session" });
      fixtures.state.userInfo.token = originalToken;
      const restored = read();
      await vi.advanceTimersByTimeAsync(100);
      expect(await restored).toEqual({ instanceUuid: "fresh-session" });
      expect(adapter).toHaveBeenCalledTimes(3);
    }
  );

  it("retains the forced request's own signal and cancellation ownership", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    adapter.mockImplementation(async (config) => {
      await held;
      return packet(config, true);
    });
    const firstController = new AbortController();
    const peerController = new AbortController();
    const first = read({ forceRequest: true, signal: firstController.signal }).catch(
      (error) => error
    );
    const peer = read({ forceRequest: true, signal: peerController.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.mock.calls[0][0].signal).toBe(firstController.signal);
    expect(adapter.mock.calls[1][0].signal).toBe(peerController.signal);
    firstController.abort();
    expect(peerController.signal.aborted).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(await first).toBeInstanceOf(Error);
    expect(await peer).toBe(true);
    expect(adapter).toHaveBeenCalledTimes(2);
    expect((apiService as any).pending.size).toBe(0);
  });

  it("preserves the 100ms publication delay and two-second success cache", async () => {
    adapter.mockImplementation(async (config) => packet(config, true));
    const api = getInstanceInfo();
    const first = api.execute();
    await vi.advanceTimersByTimeAsync(99);
    expect(api.state.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect((await first).value).toBe(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(await read()).toBe(true);
    expect(adapter).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const expired = read();
    await vi.advanceTimersByTimeAsync(100);
    expect(await expired).toBe(true);
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it("stops after two retries; a later explicit read can recover", async () => {
    adapter.mockImplementation(async (config) => {
      throw limit(config);
    });
    const result = read().catch((error) => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(((await result) as Error).message).toContain("Too many requests");
    expect(adapter).toHaveBeenCalledTimes(3);
    adapter.mockImplementation(async (config) => packet(config));
    const retry = read();
    await vi.advanceTimersByTimeAsync(100);
    expect(await retry).toBe(true);
  });

  it.each([
    ["POST", "/api/protected_instance/stream_channel"],
    ["GET", "/api/protected_instance/stream_channel"],
    ["POST", "/api/files/download"],
    ["GET", "/api/protected_instance/open"],
    ["GET", "/api/protected_instance/stop"],
    ["GET", "/api/auth/logout"],
    ["PUT", "/api/auth/update"],
    ["POST", "/api/auth/bind2fa"],
    ["DELETE", "/api/instance"],
    ["GET", "https://provider.example/api/instance"]
  ])("never replays %s %s", async (method, url) => {
    adapter.mockImplementation(async (config) => {
      throw limit(config);
    });
    const result = apiService
      .subscribe({ method, url, forceRequest: true })
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toBeInstanceOf(Error);
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("the actual terminal API sends one POST capability request and never retries its 429", async () => {
    adapter.mockImplementation(async (config) => {
      throw limit(config);
    });
    const outcome = setUpTerminalStreamChannel()
      .execute({
        params: { daemonId: "rapid-node", uuid: "rapid-server" }
      })
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await outcome).toBeInstanceOf(Error);
    expect(adapter).toHaveBeenCalledTimes(1);
    const config = adapter.mock.calls[0][0];
    expect(config.method).toBe("post");
    expect(config.url).toBe("./api/protected_instance/stream_channel");
    expect(config.params).toMatchObject({ daemonId: "rapid-node", uuid: "rapid-server" });
  });

  it.each([undefined, "invalid", "0", "-1", "6", "Infinity"])(
    "surfaces unbounded/invalid Retry-After %s",
    async (seconds) => {
      adapter.mockImplementation(async (config) => {
        throw limit(config, seconds === undefined ? null : seconds);
      });
      const result = read().catch((error) => error);
      await vi.advanceTimersByTimeAsync(10000);
      expect(await result).toBeInstanceOf(Error);
      expect(adapter).toHaveBeenCalledTimes(1);
    }
  );

  it("honors a longer bounded server cooldown and never retries a 500", async () => {
    adapter
      .mockImplementationOnce(async (config) => {
        throw limit(config, "2");
      })
      .mockImplementation(async (config) => packet(config));
    const result = read();
    await vi.advanceTimersByTimeAsync(1999);
    expect(adapter).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(101);
    expect(await result).toBe(true);
    adapter.mockImplementation(async (config) => {
      throw limit(config, "1", 500);
    });
    const failed = read({ forceRequest: true }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await failed).toBeInstanceOf(Error);
    expect(adapter).toHaveBeenCalledTimes(3);
  });

  it.each(["session", "abort"])("fences a pending retry after %s changes", async (change) => {
    adapter.mockImplementation(async (config) => {
      throw limit(config);
    });
    const controller = new AbortController();
    const result = read({ signal: controller.signal, forceRequest: true }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(0);
    if (change === "session") fixtures.state.userInfo.token = "changed-session";
    else controller.abort();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBeInstanceOf(Error);
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("does not serve a previous login's cached response to the next login", async () => {
    adapter.mockImplementation(async (config) => packet(config, fixtures.state.userInfo.token));
    const first = read();
    await vi.advanceTimersByTimeAsync(100);
    const old = await first;
    fixtures.state.userInfo.token = "next-login";
    const second = read();
    await vi.advanceTimersByTimeAsync(100);
    expect(await second).not.toBe(old);
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it.each(["session", "abort"])(
    "does not publish or cache a read when %s changes during the post-response delay",
    async (change) => {
      adapter.mockImplementation(async (config) => packet(config, { instanceUuid: "obsolete" }));
      const originalToken = fixtures.state.userInfo.token;
      const controller = new AbortController();
      const api = getInstanceInfo();
      const params = { uuid: "post-response-race", daemonId: "fixture" };
      const outcome = api.execute({ params, signal: controller.signal }).catch((error) => error);
      await vi.advanceTimersByTimeAsync(99);
      expect(adapter).toHaveBeenCalledTimes(1);
      expect(api.state.value).toBeUndefined();
      if (change === "session") fixtures.state.userInfo.token = "changed-during-cache-delay";
      else controller.abort();
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toBeInstanceOf(Error);
      expect(api.state.value).toBeUndefined();
      // Returning to the original cache identity must still perform a fresh read.
      fixtures.state.userInfo.token = originalToken;
      adapter.mockImplementation(async (config) => packet(config, { instanceUuid: "fresh" }));
      const fresh = getInstanceInfo().execute({ params });
      await vi.advanceTimersByTimeAsync(100);
      expect((await fresh).value?.instanceUuid).toBe("fresh");
      expect(adapter).toHaveBeenCalledTimes(2);
    }
  );

  it("recovers mounted read startup before LayoutCard can permanently capture an error", async () => {
    adapter
      .mockImplementationOnce(async (config) => {
        throw limit(config);
      })
      .mockImplementation(async (config) => packet(config, { instanceUuid: "recovered" }));
    fixtures.cards.Recovery = defineComponent({
      setup() {
        const { execute, state } = getInstanceInfo();
        onMounted(async () => {
          await execute({ params: { uuid: "target", daemonId: "fixture" } });
        });
        return () => h("span", state.value?.instanceUuid || "Loading");
      }
    });
    const wrapper = mount(LayoutCard, {
      props: { card: { id: "fixture", type: "Recovery", title: "Basic Info", meta: {} } as any },
      global: { stubs: { CardError: { template: "<div>Permanent Card Error</div>" } } }
    });
    wrappers.push(wrapper);
    expect(wrapper.text()).toContain("Loading");
    await vi.advanceTimersByTimeAsync(1100);
    expect(wrapper.text()).toBe("recovered");
    expect(wrapper.text()).not.toContain("Permanent Card Error");
  });

  it.each(["held HTTP", "publication delay"])(
    "keeps a mounted LayoutCard healthy when its first peer aborts during %s",
    async (phase) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      adapter.mockImplementation(async (config) => {
        if (phase === "held HTTP") await held;
        return packet(config, { instanceUuid: "Live card recovered" });
      });
      const params = { uuid: "shared-mounted", daemonId: "fixture" };
      const controller = new AbortController();
      const firstApi = getInstanceInfo();
      const first = firstApi.execute({ params, signal: controller.signal }).catch((error) => error);
      fixtures.cards.LivePeer = defineComponent({
        setup() {
          const { execute, state } = getInstanceInfo();
          onMounted(async () => {
            await execute({ params });
          });
          return () => h("span", state.value?.instanceUuid || "Loading");
        }
      });
      const wrapper = mount(LayoutCard, {
        props: {
          card: { id: "live-peer", type: "LivePeer", title: "Basic Info", meta: {} } as any
        },
        global: { stubs: { CardError: { template: "<div>Permanent Card Error</div>" } } }
      });
      wrappers.push(wrapper);
      await vi.advanceTimersByTimeAsync(phase === "held HTTP" ? 0 : 99);
      controller.abort();
      expect(await first).toBeInstanceOf(Error);
      expect(firstApi.state.value).toBeUndefined();
      release();
      await vi.advanceTimersByTimeAsync(100);
      expect(wrapper.text()).toBe("Live card recovered");
      expect(wrapper.text()).not.toContain("Permanent Card Error");
      expect(adapter).toHaveBeenCalledTimes(1);
    }
  );

  it("six mounted update statuses recover together from the panel cooldown", async () => {
    const counts = new Map<string, number>();
    adapter.mockImplementation(async (config) => {
      const project = config.params.projectId;
      const count = counts.get(project) || 0;
      counts.set(project, count + 1);
      if (!count) throw limit(config);
      return packet(config, [
        { id: "installed", version_number: "1.0", game_versions: ["1.20.1"], loaders: ["fabric"] }
      ]);
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          const updates = Array.from(
            { length: 6 },
            (_, i) =>
              useInstanceVersions(
                () =>
                  ({
                    instanceUuid: "pack" + i,
                    info: {},
                    config: {
                      packInfo: {
                        source: "modrinth",
                        projectId: "six-pills-" + sequence + "-" + i,
                        fileId: "installed",
                        versionName: "1.0",
                        mcVersion: "1.20.1",
                        loader: "fabric"
                      }
                    }
                  }) as any
              ).update
          );
          return () =>
            h(
              "div",
              updates.map((update) => h("span", update.value.status))
            );
        }
      })
    );
    wrappers.push(wrapper);
    await vi.advanceTimersByTimeAsync(0);
    expect(wrapper.text()).not.toContain("error");
    await vi.advanceTimersByTimeAsync(2200);
    expect(wrapper.text()).not.toMatch(/error|loading/);
    expect([...counts.values()]).toEqual(Array(6).fill(2));
  });
});
