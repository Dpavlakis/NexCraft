"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const http = require("node:http"),
  { once } = require("node:events"),
  { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../.."),
  base = path.join(root, "panel/src/app");
const dep = createRequire(path.join(root, "panel/package.json")),
  ts = dep("typescript");
async function fixture(options = {}) {
  let now = Date.now();
  const started = performance.now();
  const clock = () => now + (options.realtime ? Math.floor(performance.now() - started) : 0);
  const trace = [],
    providerCalls = [],
    remoteCalls = [];
  const user = {
    uuid: "fixture",
    userName: "fixture",
    permission: 10,
    passWord: "fixture-password",
    instances: []
  };
  const users = {
    getInstance: (uuid) => (uuid === user.uuid ? user : undefined),
    getUserByUserName: () => user,
    getQueryWrapper: () => ({ selectPage: () => ({ total: 0, data: [] }) })
  };
  const mocks = new Map(),
    cache = new Map();
  const mock = (name, value) => mocks.set(path.join(base, name + ".ts"), value);
  mock("service/user_service", users);
  mock("service/two_factor_service", { configureSecurity() {} });
  mock("service/log", { logger: { info() {}, error() {}, warn() {} } });
  mock("service/operation_logger", { operationLogger: { log() {} } });
  mock("service/visual_data", { addRequestCount() {} });
  mock("entity/user", { ROLE: { USER: 1, ADMIN: 10 } });
  mock("i18n", { $t: (key) => key });
  mock("setting", { systemConfig: {} });
  mock("version", { getVersion: () => "fixture" });
  mock("service/instance_service", {});
  mock("service/mini_redis", { singletonMemoryRedis: { get() {}, set() {} } });
  // Unrelated address/url safety and persistence are outside this admission fixture.
  mock("utils/url", {});
  const remote = {
    uuid: "fixture",
    available: true,
    config: { ip: "127.0.0.1", addr: "127.0.0.1", prefix: "", getConvertedRemoteMappings: () => [] }
  };
  mock("service/remote_service", {
    getInstance: () => remote,
    services: new Map([["fixture", remote]])
  });
  const instance = (id) => ({
    instanceUuid: id,
    config: {
      type: "minecraft/java",
      nickname: id,
      tag: [],
      packInfo: { source: "modrinth", projectId: id, fileId: "installed" }
    },
    info: {},
    status: 0
  });
  mock(
    "service/remote_command",
    class RemoteRequest {
      async request(event, data) {
        remoteCalls.push({ event, data });
        if (event === "instance/select")
          return {
            page: data.page,
            pageSize: data.pageSize,
            maxPage: 1,
            allTags: [],
            data: Array.from({ length: data.pageSize }, (_, i) => instance("page" + i))
          };
        if (event === "instance/detail")
          return {
            instanceUuid: data.instanceUuid,
            config: {
              type: "minecraft/java",
              nickname: data.instanceUuid,
              packInfo: { source: "modrinth", projectId: data.instanceUuid, fileId: "installed" }
            },
            info: {},
            status: 0
          };
        if (event === "instance/mods/list") return { mods: [], folders: [], total: 0 };
        return {};
      }
    }
  );
  const releases = (id) => {
    providerCalls.push(id);
    return [
      {
        id: "installed",
        name: "Installed",
        version_type: "release",
        game_versions: ["1.21"],
        loaders: ["fabric"]
      }
    ];
  };
  mock("service/mod_manager_service", {
    modManagerService: {
      getProjectVersions: async (id) => releases(id),
      getFTBModpackVersions: async (id) => releases(id),
      getCurseForgeModpackVersions: async (id) => releases(id)
    }
  });
  function source(filename) {
    if (mocks.has(filename)) return mocks.get(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const js = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText;
    vm.runInThisContext("(function(require,module,exports){" + js + "\n})", { filename })(
      (name) => {
        if (name === "mcsmanager-common")
          return {
            GlobalVariable: { get: (_key, fallback) => fallback, set() {} },
            removeTrail: (value) => value.replace(/\/$/, ""),
            isEmpty: (value) => value == null || value === ""
          };
        if (name.startsWith(".")) return source(path.resolve(path.dirname(filename), name + ".ts"));
        return dep(name);
      },
      module,
      module.exports
    );
    return module.exports;
  }
  const src = (name) => source(path.join(base, name + ".ts"));
  const app = new (dep("koa"))();
  app.keys = ["fixture-signing-key"];
  app.on("error", () => {});
  const { SessionStore } = src("service/session_store");
  const store = new SessionStore(users.getInstance, clock);
  src("service/authentication").installAuthentication(app, store, "navigation-fixture");
  app.use(src("middleware/protocol").middleware);
  app.use(async (ctx, next) => {
    await next();
    trace.push({
      time: clock(),
      elapsed: Math.round(performance.now() - started),
      method: ctx.method,
      path: ctx.path,
      target: ctx.query.uuid || ctx.query.projectId,
      status: ctx.status
    });
  });
  const router = new (dep("@koa/router"))({ prefix: "/api" });
  const passport = src("service/passport_service"),
    permission = src("middleware/permission").default;
  router.post("/fixture-login", (ctx) => {
    ctx.body = passport.loginSuccess(ctx, user.userName);
  });
  router.get("/fixture-identity", (ctx) => {
    ctx.body = { authenticated: passport.check(ctx) };
  });
  router.get("/fixture-read", permission({ level: 1 }), (ctx) => {
    ctx.session.SESSION_REQ_TIMES = [];
    ctx.body = true;
  });
  router.get("/fixture-anonymous", permission({ level: null, token: false }), (ctx) => {
    ctx.body = true;
  });
  for (const name of [
    "instance_admin_router",
    "instance_operate_router",
    "modpack_router",
    "mod_manager_router",
    "filemananger_router",
    "daemon_router"
  ])
    router.use(src("routers/" + name).default.routes());
  app.use(router.routes());
  const server = http.createServer(app.callback());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  let cookie = "",
    token;
  async function request(route, method = "GET", ownCookie = cookie) {
    const url = new URL(route, origin);
    if (token) url.searchParams.set("token", token);
    const response = await fetch(url, {
      method,
      headers: { cookie: ownCookie, "x-requested-with": "XMLHttpRequest" }
    });
    const data = await response.json();
    return { status: response.status, headers: response.headers, data: data.data };
  }
  const login = await request("/api/fixture-login", "POST");
  assert.equal(login.status, 200);
  token = login.data;
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return {
    trace,
    providerCalls,
    remoteCalls,
    request,
    store,
    origin,
    cookie: () => cookie,
    token: () => token,
    advance: (ms) => {
      now += ms;
    },
    async close() {
      store.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
// Request shapes follow InstanceList + InstanceVersionInfo + TerminalCore/BaseInfo/ManagerBtns.
// Duplicate /instance reads coalesce in ApiService; POST credential requests never do.
async function startup(h) {
  const list = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      h.request("/api/protected_modpack/versions?source=modrinth&projectId=pack" + i)
    )
  );
  // Start all three target changes without waiting for an earlier page's requests.
  const terminal = (
    await Promise.all(
      Array.from({ length: 3 }, (_, i) => {
        const query = "?daemonId=fixture&uuid=pack" + i;
        return Promise.all([
          h.request("/api/instance" + query),
          h.request("/api/mod/list" + query),
          h.request("/api/protected_instance/stream_channel" + query, "POST"),
          h.request("/api/files/download" + query + "&file_name=server-icon.png", "POST")
        ]);
      })
    )
  ).flat();
  return [...list, ...terminal];
}

// Compile the CURRENT page/cards, retaining child-before-parent mount order, the
// real four-wide version cache, ApiService (including 100ms publication), and API
// declarations. Only visual shells, stores and daemon/provider boundaries are faked.
async function mountedPage(h) {
  const front = createRequire(path.join(root, "frontend/package.json"));
  const { JSDOM } = front("jsdom");
  const dom = new JSDOM("<div id='app'></div>", { url: h.origin });
  const globals = [
    "window",
    "document",
    "navigator",
    "Element",
    "HTMLElement",
    "SVGElement",
    "Node",
    "localStorage"
  ];
  const saved = globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const key of globals)
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
  const vue = front("vue"),
    compiler = front("@vue/compiler-sfc");
  const axios = front("axios").default,
    oldAdapter = axios.defaults.adapter;
  const interceptorIds = new Set(axios.interceptors.request.handlers.filter(Boolean));
  const transport = [],
    errors = [],
    cache = new Map(),
    mocks = new Map();
  let activeVersions = 0,
    maxActiveVersions = 0;
  const ui = vue.defineComponent({
    setup(_, { slots }) {
      return () =>
        vue.h(
          "div",
          Object.values(slots).flatMap((slot) => slot?.() || [])
        );
    }
  });
  const src = path.join(root, "frontend/src");
  const mock = (name, value) => mocks.set(path.join(src, name), value);
  mock("lang/i18n", { t: (key) => key });
  mock("stores/useAppStateStore", {
    useAppStateStore: () => ({ state: { userInfo: { token: h.token() } }, isAdmin: vue.ref(true) })
  });
  mock("stores/useLayoutContainerStore", {
    useLayoutContainerStore: () => ({ containerState: {} })
  });
  mock("config/router", { router: { push() {} } });
  mock("hooks/useScreen", { useScreen: () => ({ isPhone: vue.ref(false) }) });
  mock("hooks/useAppRouters", { useAppRouters: () => ({ toPage() {} }) });
  mock("hooks/useCardTools", {
    useLayoutCardTools: (card) => ({ getMetaOrRouteValue: (key) => card.meta[key] })
  });
  mock("hooks/useFileManager", { getFileConfigAddr: () => "http://127.0.0.1" });
  mock("tools/validator", { reportErrorMsg: (error) => errors.push(error) });
  mock("tools/loaderIcon", { loaderIconFor: () => "" });
  mock("components/fc/index", { openInstanceTagsEditor() {}, useDeleteInstanceDialog() {} });
  for (const name of [
    "components/CardPanel.vue",
    "components/BetweenMenus.vue",
    "widgets/instance/InstanceLine.vue",
    "widgets/instance/ServerSourceBadge.vue"
  ])
    mock(name, { __esModule: true, default: ui });
  function load(filename) {
    if (mocks.has(filename)) return mocks.get(filename);
    if (!path.extname(filename))
      filename =
        fs.existsSync(filename) && fs.statSync(filename).isDirectory()
          ? path.join(filename, "index.ts")
          : filename + ".ts";
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    let code = fs.readFileSync(filename, "utf8");
    if (filename.endsWith(".vue")) {
      const { descriptor } = compiler.parse(code, { filename });
      code = compiler.compileScript(descriptor, { id: filename, inlineTemplate: true }).content;
    }
    const js = ts.transpileModule(code, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText;
    vm.runInThisContext("(function(require,module,exports){" + js + "\n})", { filename })(
      (name) => {
        if (name.startsWith("@/")) return load(path.join(src, name.slice(2)));
        if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name));
        if (name === "ant-design-vue") return { Modal: {}, notification: {}, message: {} };
        if (name === "@ant-design/icons-vue") return new Proxy({}, { get: () => ui });
        if (name === "pretty-bytes") return () => "0 B";
        return front(name);
      },
      module,
      module.exports
    );
    return module.exports;
  }
  axios.defaults.adapter = async (config) => {
    const url = new URL(config.url.replace(/^\./, ""), h.origin);
    for (const [key, value] of Object.entries(config.params || {}))
      if (value != null) url.searchParams.set(key, String(value));
    const method = config.method.toUpperCase();
    const version = url.pathname === "/api/protected_modpack/versions";
    if (version) maxActiveVersions = Math.max(maxActiveVersions, ++activeVersions);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { cookie: h.cookie(), "x-requested-with": "XMLHttpRequest" },
        signal: config.signal
      });
    } finally {
      if (version) activeVersions--;
    }
    const data = await response.json();
    transport.push({
      path: url.pathname,
      target: url.searchParams.get("uuid") || url.searchParams.get("projectId"),
      method,
      status: response.status
    });
    const packet = {
      config,
      data,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers)
    };
    if (response.status >= 400)
      throw new (front("axios").AxiosError)(
        "HTTP " + response.status,
        "ERR_BAD_RESPONSE",
        config,
        undefined,
        packet
      );
    return packet;
  };
  const Page = load(path.join(src, "widgets/InstanceList.vue")).default;
  const app = vue.createApp(Page, { card: { id: "page", title: "Instances", meta: {} } });
  const components = new Set();
  // Auto-registered presentation components are slot-preserving shells here.
  for (const filename of ["widgets/InstanceList.vue", "widgets/instance/Shortcut.vue"]) {
    const template = compiler.parse(fs.readFileSync(path.join(src, filename), "utf8")).descriptor
      .template.content;
    for (const match of template.matchAll(/<((?:a-|fade-)[\w-]+|Loading)\b/g))
      components.add(match[1]);
  }
  for (const name of components) app.component(name, ui);
  app.config.warnHandler = () => {};
  app.config.errorHandler = (error) => errors.push(String(error));
  app.mount(dom.window.document.getElementById("app"));
  const waitFor = async (condition, timeout = 4500) => {
    const end = performance.now() + timeout;
    while (!condition()) {
      assert.ok(
        performance.now() < end,
        "mounted page did not settle: " + JSON.stringify({ errors, transport })
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  return {
    dom,
    errors,
    transport,
    waitFor,
    maxVersions: () => maxActiveVersions,
    api: (name) => load(path.join(src, "services/apis/" + name)),
    async close() {
      app.unmount();
      axios.defaults.adapter = oldAdapter;
      axios.interceptors.request.handlers.forEach((handler, i) => {
        if (handler && !interceptorIds.has(handler)) axios.interceptors.request.eject(i);
      });
      dom.window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  };
}

test("actual default 20-card mount and initial terminal navigation retain every credential once", async (t) => {
  const h = await fixture();
  let page;
  try {
    page = await mountedPage(h);
    await page.waitFor(
      () => page.transport.filter((r) => r.path === "/api/files/download").length === 20
    );
    // The icons publish after ApiService's real 100ms window; a user can then
    // open a card while the four-wide version queue is still draining/retrying.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const { getInstanceInfo, setUpTerminalStreamChannel } = page.api("instance");
    const { downloadAddress } = page.api("fileManager");
    const { modListApi } = page.api("modManager");
    const params = { daemonId: "fixture", uuid: "page0" };
    // Initial navigation: BaseInfo/hook/ManagerBtns coalesce detail; credentials never replay.
    const navigation = await Promise.allSettled([
      ...Array.from({ length: 3 }, () => getInstanceInfo().execute({ params })),
      modListApi().execute({ params }),
      setUpTerminalStreamChannel().execute({ params }),
      downloadAddress().execute({ params: { ...params, file_name: "server-icon.png" } })
    ]);
    await page.waitFor(
      () =>
        [...page.dom.window.document.querySelectorAll(".version-status")].length === 20 &&
        [...page.dom.window.document.querySelectorAll(".version-status")].every(
          (el) => el.dataset.status !== "loading"
        )
    );
    const counts = Object.fromEntries(
      [...new Set(page.transport.map((r) => r.path))].map((route) => [
        route,
        {
          calls: page.transport.filter((r) => r.path === route).length,
          denied: page.transport.filter((r) => r.path === route && r.status === 429).length
        }
      ])
    );
    const charged = h.trace.filter(
      (r) => !r.path.startsWith("/api/fixture-") && !r.path.startsWith("/api/service/")
    );
    t.diagnostic(
      JSON.stringify({
        counts,
        chargedCalls: charged.length,
        chargedElapsedMs:
          Math.max(...charged.map((r) => r.elapsed)) - Math.min(...charged.map((r) => r.elapsed)),
        maxActiveVersions: page.maxVersions(),
        trace: h.trace,
        providerCalls: h.providerCalls.length,
        registrations: h.remoteCalls.filter((r) => r.event === "passport/register").length,
        navigation: navigation.map((r) => r.status),
        errors: page.errors
      })
    );
    assert.equal(page.dom.window.document.querySelectorAll(".game-instance-card").length, 20);
    assert.equal(h.remoteCalls.find((r) => r.event === "instance/select").data.pageSize, 20);
    assert.equal(page.maxVersions(), 4);
    assert.equal(page.transport.length, 46);
    assert.ok(page.transport.every((r) => r.status === 200));
    for (let i = 0; i < 20; i++)
      assert.equal(
        page.transport.filter((r) => r.path === "/api/files/download" && r.target === "page" + i)
          .length,
        i === 0 ? 2 : 1
      );
    assert.deepEqual(page.errors, []);
    assert.ok(
      navigation.every((r) => r.status === "fulfilled"),
      "initial navigation credentials must succeed"
    );
    assert.ok(
      page.transport.filter((r) => r.method === "POST").every((r) => r.status === 200),
      "icon/stream credentials must not be throttled"
    );
    assert.equal(counts["/api/files/download"].calls, 21);
    assert.equal(counts["/api/protected_instance/stream_channel"].calls, 1);
    assert.equal(counts["/api/instance"].calls, 1);
    assert.equal(h.remoteCalls.filter((r) => r.event === "passport/register").length, 22);
    assert.equal(h.providerCalls.length, 20);
    assert.ok(
      [...page.dom.window.document.querySelectorAll(".version-status")].every(
        (el) => el.dataset.status === "current"
      )
    );
    // Repeated navigation at the SAME store clock exceeds the former 48 ceiling.
    for (let wave = 0; wave < 4; wave++) {
      const results = await Promise.allSettled(
        Array.from({ length: 3 }, (_, i) => {
          const params = { daemonId: "fixture", uuid: `navigation${wave}-${i}` };
          return Promise.all([
            getInstanceInfo().execute({ params }),
            modListApi().execute({ params }),
            setUpTerminalStreamChannel().execute({ params }),
            downloadAddress().execute({ params: { ...params, file_name: "server-icon.png" } })
          ]);
        })
      );
      assert.ok(results.every((r) => r.status === "fulfilled"));
    }
    assert.equal(page.transport.length, 94);
    assert.ok(page.transport.every((r) => r.status === 200));
    assert.equal(h.remoteCalls.filter((r) => r.event === "passport/register").length, 46);
    assert.deepEqual(page.errors, []);
  } finally {
    if (page) await page.close();
    await h.close();
  }
});
test("mounted cold six-pack checks and three rapid terminal views stay admitted", async (t) => {
  const h = await fixture();
  try {
    const responses = await startup(h);
    t.diagnostic(
      JSON.stringify({
        trace: h.trace,
        providerCalls: h.providerCalls.length,
        remoteCalls: h.remoteCalls.length
      })
    );
    assert.deepEqual(
      responses.map((r) => r.status),
      Array(18).fill(200)
    );
    assert.equal(h.providerCalls.length, 6);
    assert.equal(h.remoteCalls.filter((r) => r.event === "passport/register").length, 6);
    const streams = h.remoteCalls.filter(
      (r) => r.event === "passport/register" && r.data.name === "stream_channel"
    );
    assert.equal(streams.length, 3);
    assert.deepEqual(streams.map((r) => r.data.parameter.instanceUuid).sort(), [
      "pack0",
      "pack1",
      "pack2"
    ]);
    assert.equal(new Set(streams.map((r) => r.data.password)).size, 3);
    for (let i = 0; i < 3; i++) {
      const registration = streams.find((r) => r.data.parameter.instanceUuid === "pack" + i);
      assert.equal(responses[6 + i * 4 + 2].data.password, registration.data.password);
    }
    assert.deepEqual(
      h.trace
        .filter((r) => r.path === "/api/protected_instance/stream_channel")
        .map((r) => [r.method, r.status]),
      [
        ["POST", 200],
        ["POST", 200],
        ["POST", 200]
      ]
    );
    for (let wave = 0; wave < 4; wave++) {
      const repeated = await startup(h);
      assert.ok(repeated.every((r) => r.status === 200));
    }
  } finally {
    await h.close();
  }
});

test("simultaneous normal signed-in waves remain unlimited at a frozen clock", async () => {
  const h = await fixture();
  try {
    for (let wave = 0; wave < 4; wave++) {
      const ordinary = await Promise.all(
        Array.from({ length: 128 }, () => h.request("/api/fixture-read"))
      );
      assert.ok(ordinary.every((r) => r.status === 200));
    }
    const responses = await startup(h);
    assert.ok(responses.every((r) => r.status === 200));
    assert.deepEqual((await h.request("/api/fixture-identity")).data, { authenticated: true });
    assert.equal(h.providerCalls.length, 6);
    assert.equal(h.remoteCalls.filter((r) => r.event === "passport/register").length, 6);
  } finally {
    await h.close();
  }
});

test("anonymous browser admission retains eight-per-second sliding accounting", async () => {
  const h = await fixture();
  try {
    const first = await h.request("/api/fixture-anonymous", "GET", "");
    assert.equal(first.status, 200);
    const cookie = first.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.ok(cookie.includes("navigation-fixture="));
    const wave = await Promise.all(
      Array.from({ length: 8 }, () => h.request("/api/fixture-anonymous", "GET", cookie))
    );
    assert.equal(wave.filter((r) => r.status === 200).length, 7);
    assert.equal(wave.filter((r) => r.status === 429).length, 1);
    h.advance(1001);
    assert.equal((await h.request("/api/fixture-anonymous", "GET", cookie)).status, 200);
  } finally {
    await h.close();
  }
});
