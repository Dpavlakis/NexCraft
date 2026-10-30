import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  setup: vi.fn(),
  makeSocket: vi.fn(),
  history: vi.fn(),
  fit: vi.fn(),
  write: vi.fn(),
  dispose: vi.fn()
}));
vi.mock("ant-design-vue", () => ({ message: { success: vi.fn() }, Modal: {} }));
vi.mock("@ant-design/icons-vue", () => ({
  CodeOutlined: { render: () => null },
  DeleteOutlined: { render: () => null },
  DownOutlined: { render: () => null },
  LoadingOutlined: { render: () => null }
}));
vi.mock("@/stores/useLayoutContainerStore", () => ({
  useLayoutContainerStore: () => ({ containerState: { isDesignMode: false } })
}));
vi.mock("@/lang/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/services/apis/instance", () => ({
  setUpTerminalStreamChannel: () => ({ execute: api.setup }),
  getInstanceOutputLog: () => ({ execute: vi.fn().mockResolvedValue(ref("")) })
}));
vi.mock("@/hooks/useSocketIo", () => ({ makeSocketIo: api.makeSocket }));
vi.mock("@/hooks/useCommandHistory", () => ({
  useCommandHistory: () => ({
    setHistory: api.history,
    focusHistoryList: ref(false),
    selectLocation: ref(0),
    history: ref([]),
    commandInputValue: ref(""),
    handleHistorySelect: vi.fn(),
    clickHistoryItem: vi.fn()
  })
}));
vi.mock("@/stores/useAppConfigStore", () => ({
  useAppConfigStore: () => ({ hasBgImage: ref(false) })
}));
vi.mock("@/tools/copy", () => ({ toCopy: vi.fn() }));
vi.mock("@/tools/protocol", () => ({
  parseForwardAddress: (addr: string) => "ws://" + addr,
  mapDaemonAddress: vi.fn()
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function () {
    return {
      cols: 81,
      rows: 25,
      unicode: {},
      loadAddon: vi.fn(),
      open: vi.fn(),
      attachCustomKeyEventHandler: vi.fn(),
      onData: vi.fn(),
      write: api.write,
      dispose: api.dispose
    };
  })
}));
vi.mock("@xterm/addon-canvas", () => ({ CanvasAddon: vi.fn(function () {}) }));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function () {
    return { fit: api.fit };
  })
}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: vi.fn(function () {}) }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: vi.fn() }));
import { useTerminal } from "@/hooks/useTerminal";
import TerminalCore from "@/components/TerminalCore.vue";
import { flushPromises } from "./helpers";

function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function socketFixture() {
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket = {
    connected: true,
    handlers,
    on: vi.fn((name: string, callback: (...args: any[]) => void) => {
      handlers.set(name, callback);
      return socket;
    }),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(() => handlers.clear())
  };
  return socket;
}
const hosts: VueWrapper[] = [];
const sockets: ReturnType<typeof socketFixture>[] = [];
function host() {
  let hook!: ReturnType<typeof useTerminal>;
  const wrapper = mount(
    defineComponent({
      setup() {
        hook = useTerminal();
        return () => h("div");
      }
    })
  );
  hosts.push(wrapper);
  return { wrapper, hook };
}
const target = { daemonId: "node-a", instanceId: "server-a" };
const response = (password = "secret-a") => ref({ addr: "node:24444", prefix: "", password });
beforeEach(() => {
  vi.useFakeTimers();
  api.setup.mockReset().mockResolvedValue(response());
  api.history.mockReset();
  api.fit.mockReset();
  api.write.mockReset();
  api.dispose.mockReset();
  api.makeSocket.mockReset().mockImplementation(() => {
    const socket = socketFixture();
    sockets.push(socket);
    return socket;
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  hosts.splice(0).forEach((h) => h.unmount());
  sockets.length = 0;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("terminal setup ownership", () => {
  it("cannot allocate or connect after unmount while channel setup is pending", async () => {
    const pending = deferred();
    api.setup.mockReturnValueOnce(pending.promise);
    const { hook, wrapper } = host();
    const event = vi.fn();
    hook.events.on("connect", event);
    const setup = hook.execute(target);
    wrapper.unmount();
    pending.resolve(response());
    await setup;
    expect(api.makeSocket).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ignores late setup failure after disposal", async () => {
    const pending = deferred();
    api.setup.mockReturnValueOnce(pending.promise);
    const { hook, wrapper } = host();
    const error = vi.fn();
    hook.events.on("error", error);
    const setup = hook.execute(target);
    const outcome = setup.catch((e) => e);
    wrapper.unmount();
    pending.reject(new Error("late channel failure"));
    expect(await outcome).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
    expect(api.makeSocket).not.toHaveBeenCalled();
  });
  it("does not allocate across repeated pending mount/unmount cycles", async () => {
    for (let i = 0; i < 3; i++) {
      const pending = deferred();
      api.setup.mockReturnValueOnce(pending.promise);
      const { hook, wrapper } = host();
      const setup = hook.execute(target);
      wrapper.unmount();
      pending.resolve(response());
      await setup;
    }
    expect(api.makeSocket).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("leaves one socket when same-target requests settle in reverse order", async () => {
    const first = deferred(),
      second = deferred();
    api.setup.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { hook } = host();
    const a = hook.execute(target),
      b = hook.execute(target);
    second.resolve(response("new"));
    await Promise.resolve();
    first.resolve(response("old"));
    await Promise.all([a, b]);
    expect(sockets.filter((s) => s.disconnect.mock.calls.length === 0)).toHaveLength(1);
  });
  it("fences older setup of a different target before allocation", async () => {
    const first = deferred(),
      second = deferred();
    api.setup.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { hook } = host();
    const a = hook.execute(target),
      b = hook.execute({ daemonId: "node-b", instanceId: "server-b" });
    second.resolve(response("secret-b"));
    const live = await b;
    first.resolve(response("secret-a"));
    await a;
    expect(api.setup.mock.calls.map(([request]) => request.params)).toEqual([
      { daemonId: "node-a", uuid: "server-a" },
      { daemonId: "node-b", uuid: "server-b" }
    ]);
    expect(api.makeSocket).toHaveBeenCalledTimes(1);
    expect(live).toBe(sockets[0]);
    sockets[0].handlers.get("connect")!();
    expect(sockets[0].emit).toHaveBeenCalledWith("stream/auth", { data: { password: "secret-b" } });
  });
  it("ignores failure from a superseded setup but preserves current failures", async () => {
    const first = deferred();
    api.setup.mockReturnValueOnce(first.promise);
    const { hook } = host();
    const old = hook.execute(target);
    const outcome = old.catch((e) => e);
    await hook.execute({ daemonId: "node-b", instanceId: "server-b" });
    first.reject(new Error("obsolete"));
    expect(await outcome).toBeUndefined();
    api.setup.mockRejectedValueOnce(new Error("current"));
    await expect(hook.execute({ daemonId: "node-c", instanceId: "server-c" })).rejects.toThrow(
      "current"
    );
  });
  it("replaces a connected target and fences saved callbacks from its old socket", async () => {
    const { hook } = host();
    await hook.execute(target);
    const old = sockets[0];
    const callbacks = new Map(old.handlers);
    api.setup.mockResolvedValueOnce(response("secret-b"));
    await hook.execute({ daemonId: "node-b", instanceId: "server-b" });
    expect(api.makeSocket).toHaveBeenCalledTimes(2);
    const live = sockets[1];
    live.emit.mockClear();
    const event = vi.fn();
    for (const name of ["connect", "error", "stdout", "detail", "opened", "stopped", "disconnect"])
      hook.events.on(name, event);
    for (const name of [
      "connect",
      "reconnect",
      "disconnect",
      "instance/opened",
      "instance/stopped"
    ])
      callbacks.get(name)!();
    callbacks.get("stream/auth")!({ data: true });
    callbacks.get("connect_error")!(new Error("old"));
    callbacks.get("stream/detail")!({ data: { config: { nickname: "obsolete" } } });
    callbacks.get("instance/stdout")!({ data: { text: "obsolete" } });
    expect(live.emit).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
    expect(hook.state.value).toBeUndefined();
    expect(old.disconnect).toHaveBeenCalledTimes(1);
    expect(old.removeAllListeners).toHaveBeenCalledTimes(1);
  });
  it("reuses the socket for a subsequent live execution of the same target", async () => {
    const { hook } = host();
    const first = await hook.execute(target);
    expect(await hook.execute(target)).toBe(first);
    expect(api.setup).toHaveBeenCalledTimes(1);
    expect(api.makeSocket).toHaveBeenCalledTimes(1);
  });
  it("retains the two-second fit/resize interval and stdout terminal output", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { hook, wrapper } = host();
    await hook.execute(target);
    hook.initTerminalWindow(document.createElement("div"));
    const live = sockets[0];
    expect(api.fit).toHaveBeenCalledTimes(1);
    expect(live.emit).toHaveBeenCalledWith("stream/resize", { data: { w: 80, h: 24 } });
    await vi.advanceTimersByTimeAsync(1999);
    expect(api.fit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.fit).toHaveBeenCalledTimes(2);
    live.handlers.get("stream/detail")!({
      data: { config: { terminalOption: { haveColor: false } } }
    });
    live.handlers.get("instance/stdout")!({ data: { text: "server ready" } });
    expect(api.write).toHaveBeenCalledExactlyOnceWith("server ready");
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses first-time terminal window allocation after disposal", () => {
    const { hook, wrapper } = host();
    wrapper.unmount();
    expect(hook.initTerminalWindow(document.createElement("div"))).toBeUndefined();
    expect(api.fit).not.toHaveBeenCalled();
    expect(hook.terminal.value).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("disposes xterm and its touch handlers, clears its ref, and refuses late window allocation", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { hook, wrapper } = host();
    const element = document.createElement("div");
    const add = vi.spyOn(element, "addEventListener"),
      remove = vi.spyOn(element, "removeEventListener");
    const interval = vi.spyOn(globalThis, "setInterval");
    hook.initTerminalWindow(element);
    expect(vi.getTimerCount()).toBe(2);
    const fit = interval.mock.calls.find(([, delay]) => delay === 2000)![0] as () => void;
    const handlers = add.mock.calls.filter(([name]) => name.startsWith("touch"));
    expect(handlers).toHaveLength(4);
    wrapper.unmount();
    expect(api.dispose).toHaveBeenCalledTimes(1);
    expect(hook.terminal.value).toBeUndefined();
    for (const [name, callback, options] of handlers)
      expect(remove).toHaveBeenCalledWith(name, callback, options);
    fit();
    expect(hook.initTerminalWindow(document.createElement("div"))).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(api.fit).toHaveBeenCalledTimes(1);
  });
  it("ignores retained socket callbacks and execute after disposal", async () => {
    const { hook, wrapper } = host();
    await hook.execute(target);
    const callbacks = new Map(sockets[0].handlers);
    const event = vi.fn();
    wrapper.unmount();
    hook.events.on("error", event);
    hook.events.on("stdout", event);
    callbacks.get("connect")!();
    callbacks.get("connect_error")!(new Error("late"));
    callbacks.get("instance/stdout")!({ data: { text: "late" } });
    await hook.execute(target);
    expect(api.makeSocket).toHaveBeenCalledTimes(1);
    expect(sockets[0].emit).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  });
  it("preserves live auth, detail, stdout, reconnect, polling, input and cleanup", async () => {
    const { hook, wrapper } = host();
    const socket = await hook.execute(target);
    expect(socket).toBe(sockets[0]);
    const live = sockets[0];
    const observed = vi.fn();
    for (const name of ["connect", "stdout", "detail", "opened", "stopped", "disconnect", "error"])
      hook.events.on(name, observed);
    live.handlers.get("connect")!();
    expect(hook.isConnect.value).toBe(true);
    expect(live.emit).toHaveBeenLastCalledWith("stream/auth", { data: { password: "secret-a" } });
    live.handlers.get("stream/auth")!({ data: true });
    expect(live.emit).toHaveBeenLastCalledWith("stream/detail", {});
    const detail = {
      status: 3,
      config: { nickname: "server", terminalOption: { haveColor: false } }
    };
    live.handlers.get("stream/detail")!({ data: detail });
    expect(hook.state.value).toEqual(detail);
    live.handlers.get("instance/stdout")!({ data: { text: "hello" } });
    expect(observed).toHaveBeenCalledWith({ text: "hello" });
    live.handlers.get("instance/opened")!();
    live.handlers.get("instance/stopped")!();
    live.handlers.get("disconnect")!();
    expect(hook.isConnect.value).toBe(false);
    live.handlers.get("reconnect")!();
    expect(hook.isConnect.value).toBe(true);
    expect(live.emit).toHaveBeenLastCalledWith("stream/auth", { data: { password: "secret-a" } });
    live.handlers.get("stream/auth")!({ data: false });
    expect(observed).toHaveBeenCalledWith(expect.any(Error));
    live.emit.mockClear();
    await vi.advanceTimersByTimeAsync(999);
    expect(live.emit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(live.emit).toHaveBeenCalledExactlyOnceWith("stream/detail", {});
    hook.sendCommand("list");
    expect(live.emit).toHaveBeenLastCalledWith("stream/input", { data: { command: "list" } });
    wrapper.unmount();
    expect(live.disconnect).toHaveBeenCalledTimes(1);
    expect(live.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

function mountCore(hook: ReturnType<typeof useTerminal>) {
  const errors: unknown[] = [];
  const wrapper = mount(TerminalCore, {
    attachTo: document.body,
    props: { ...target, height: "400px", useTerminalHook: hook },
    global: {
      config: {
        errorHandler: (error) => errors.push(error)
      },
      mocks: { $t: (key: string) => key },
      stubs: {
        "a-tooltip": true,
        "a-tag": true,
        "a-input": true,
        "a-typography-title": true,
        "a-typography-paragraph": true,
        "a-typography-link": true
      }
    }
  });
  hosts.push(wrapper);
  return { wrapper, errors };
}
describe("terminal core setup continuation", () => {
  it.each(["resolve", "reject"] as const)(
    "ignores obsolete setup %s after core unmount",
    async (outcome) => {
      const { hook } = host();
      const pending = deferred();
      hook.execute = vi.fn().mockReturnValue(pending.promise);
      hook.initTerminalWindow = vi.fn();
      const { wrapper, errors } = mountCore(hook);
      wrapper.unmount();
      if (outcome === "resolve") pending.resolve(undefined);
      else pending.reject(new Error("obsolete setup"));
      await flushPromises();
      expect(hook.initTerminalWindow).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
      expect(errors).toEqual([]);
    }
  );
  it("retains active setup failure reporting", async () => {
    const { hook } = host();
    const error = new Error("current setup");
    hook.execute = vi.fn().mockRejectedValue(error);
    hook.initTerminalWindow = vi.fn();
    const { errors } = mountCore(hook);
    await flushPromises();
    expect(errors).toEqual([error]);
    expect(console.error).toHaveBeenCalledWith(error);
    expect(hook.initTerminalWindow).not.toHaveBeenCalled();
  });
  it("initializes the terminal and scroll listener after live setup", async () => {
    const { hook } = host();
    hook.execute = vi.fn().mockResolvedValue(undefined);
    const terminal = { onScroll: vi.fn(), buffer: { active: { viewportY: 0, baseY: 0 } } };
    hook.initTerminalWindow = vi.fn().mockReturnValue(terminal);
    const { errors } = mountCore(hook);
    await flushPromises();
    expect(hook.initTerminalWindow).toHaveBeenCalledTimes(1);
    expect(terminal.onScroll).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });
});
