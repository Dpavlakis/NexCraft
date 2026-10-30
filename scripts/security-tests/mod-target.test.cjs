"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const Module = require("node:module");
const Koa = require("../../panel/node_modules/koa");
const Router = require("../../panel/node_modules/@koa/router");
const { koaBody } = require("../../panel/node_modules/koa-body");
require("../../panel/node_modules/ts-node").register({
  project: path.resolve(__dirname, "../../panel/tsconfig.json"),
  transpileOnly: true
});

const calls = [];
const metadataCalls = [];
const rateLimits = new Map();
const globals = new Map();
let allowed = true;
let fileManager = true;
let userLevel = 1;
let mutate = false;
const currentUser = () => userLevel > 0
  ? { uuid: "user", userName: "tester", permission: userLevel } : undefined;
const passport = {
  getUserUuid: (ctx) => ctx.session.uuid || "",
  getUserPermission: () => userLevel,
  getUserFromCtx: (ctx) => {
    // Simulate middleware mutating inputs AFTER target authorization.
    if (mutate) {
      Object.assign(ctx.query, { daemonId: "changed", uuid: "changed" });
      if (ctx.request.body) Object.assign(ctx.request.body, { daemonId: "changed", uuid: "changed" });
    }
    return currentUser();
  },
  isAjax: (ctx) => ctx.get("x-requested-with") === "XMLHttpRequest",
  getUuidByApiKey: () => undefined,
  ILLEGAL_ACCESS_KEY: "illegalAccess",
  logout: () => { throw new Error("unexpected logout"); }
};
const routerMocks = {
  "../i18n": { $t: (s) => s },
  "../service/mod_manager_service": { modManagerService: new Proxy({}, {
    get: (_, method) => async (...args) => {
      metadataCalls.push([method, ...args]);
      if (method === "searchProjects")
        assert.ok(mutexIdMap.has("UserConcurrencyLimiter:user:mod_manager:search"));
      return "metadata";
    }
  }) },
  "../service/passport_service": passport,
  "../service/permission_service": {
    isHaveInstanceByUuid: (user, daemon, uuid) => {
      calls.push(["authorize", daemon, uuid]);
      return user === "user" && allowed && daemon === "daemon" && uuid === "owned";
    }
  },
  "../service/remote_command": { __esModule: true, default: class {
    constructor(daemon) { this.daemon = daemon; }
    async request(event, payload) {
      if (event === "instance/mods/install")
        assert.ok(mutexIdMap.has("UserConcurrencyLimiter:user:mod_manager:download"));
      calls.push(["rpc", this.daemon, event, payload]);
      return "ok";
    }
  } },
  "../service/remote_service": { __esModule: true, default: { getInstance: (id) => id } },
  "../setting": { systemConfig: { get canFileManager() { return fileManager; } } },
  "../utils/url": { checkSafeUrl: () => true }
};
const middlewareMocks = {
  "../service/session_store": { browserRequestAdmission: () => undefined, liveBrowserUser: currentUser },
  "../i18n": routerMocks["../i18n"],
  "../service/passport_service": passport,
  "../service/user_service": { __esModule: true, default: {
    getInstance: (uuid) => uuid === "user" ? currentUser() : undefined
  } },
  "mcsmanager-common": { GlobalVariable: {
    get: (key, fallback) => globals.get(key) ?? fallback,
    set: (key, value) => globals.set(key, value)
  } },
  "../service/mini_redis": { singletonMemoryRedis: {
    get: (key) => rateLimits.get(key),
    set: (key, value) => rateLimits.set(key, value),
    ttl: () => 1
  } }
};
const originalLoad = Module._load;
Module._load = function(id, parent, ...args) {
  const filename = parent?.filename || "";
  if (filename.endsWith(path.join("routers", "mod_manager_router.ts")) && routerMocks[id])
    return routerMocks[id];
  if (["permission.ts", "limit.ts"].some(file => filename.endsWith(path.join("middleware", file)))
      && middlewareMocks[id]) return middlewareMocks[id];
  return originalLoad.call(this, id, parent, ...args);
};
let router;
try { router = require("../../panel/src/app/routers/mod_manager_router.ts").default; }
finally { Module._load = originalLoad; }
const { resolveModTarget } = require("../../panel/src/app/utils/mod_target.ts");
const { mutexIdMap } = require("../../panel/src/app/utils/sync.ts");

// Match app/index.ts nesting and allowedMethods, never flatten router.stack.
const app = new Koa();
let dispatchedContext;
app.use(async (ctx, next) => {
  ctx.session = userLevel > 0
    ? { login: true, uuid: "user", userName: "tester", token: "test-token" } : {};
  try { await next(); }
  catch (error) { ctx.body = error; }
  // Mirror protocol's error status without booting unrelated application services.
  if (ctx.body instanceof Error) {
    const message = ctx.body.message;
    ctx.status = 500;
    ctx.body = message;
  }
  dispatchedContext = ctx;
});
app.use(koaBody({ parsedMethods: ["GET", "PUT", "POST", "DELETE"] }));
const apiRouter = new Router({ prefix: "/api" });
apiRouter.use(router.routes()).use(router.allowedMethods());
app.use(apiRouter.routes()).use(apiRouter.allowedMethods());
let server;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
});
after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
});

const ids = { daemonId: "daemon", uuid: "owned" };
const data = { fileName: "mod.jar", type: "download", url: "https://example.com/mod.jar",
  projectType: "mod", modId: "mod" };
const instanceRoutes = [
  ["GET", "list", "instance/mods/list"],
  ["GET", "config_files", "instance/mods/config_files"],
  ["POST", "download", "instance/mods/install"],
  ["POST", "stop_transfer", "file/download_from_url_stop"],
  ["POST", "toggle", "instance/mods/toggle"],
  ["POST", "delete", "instance/mods/delete"]
];
async function run(method, route, query = {}, body = {}, options = {}) {
  calls.length = 0;
  metadataCalls.length = 0;
  if (!options.keepRateLimits) rateLimits.clear();
  dispatchedContext = undefined;
  const params = new URLSearchParams({ token: "test-token" });
  for (const [key, value] of Object.entries(query)) {
    // HTTP query values are strings or repeated strings; body tests cover typed values.
    if (value == null) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  const json = JSON.stringify(body);
  const response = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1", port: server.address().port,
      path: (options.path || "/api/mod/" + route) + "?" + params,
      method, agent: false,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(json),
        "x-requested-with": "XMLHttpRequest", ...options.headers }
    }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: text, headers: res.headers }));
    });
    request.on("error", reject);
    request.end(json);
  });
  assert.ok(dispatchedContext, "request must traverse real Koa middleware");
  return { ...response, state: dispatchedContext.state };
}
function assertNoEffects() {
  assert.equal(calls.length, 0, "no ownership check or instance RPC");
  assert.equal(metadataCalls.length, 0, "no provider call");
}

const metadataCases = [
  ["GET", "mc_versions", {}, {}, ["getMinecraftVersions"]],
  ["GET", "info", { hash: "hash" }, {}, ["getInfoByHash", "hash"]],
  ["POST", "batch_info", {}, { hashes: ["hash"] }, ["getInfosByHashes", ["hash"]]],
  ...[undefined, "all", "curseforge", "modrinth", "ftb", "spigotmc"].map(source => {
    // Match the three ModpackBrowser tabs; retain aggregate/default search coverage.
    const type = ["curseforge", "modrinth", "ftb"].includes(source) ? "modpack" : "all";
    return ["GET", "search", source ? { source, type } : {}, {},
      ["searchProjects", "", 0, 20, { source: source || "all", version: "", type,
        loader: "all", environment: "all", sort: "featured" }]];
  }),
  ...["CurseForge", "Modrinth", "FTB"].map(source => [
    "GET", "versions", { projectId: "p", source }, {}, ["getProjectVersions", "p", source]
  ])
];
for (const [method, route, query, body, expected] of metadataCases) {
  test(`mounted metadata ${route} ${query.source || "default"} remains target-free`, async () => {
    try {
      for (const level of [1, 10]) {
        userLevel = level;
        // File-manager policy applies to instances, not browsing.
        fileManager = false;
        const ctx = await run(method, route, query, body);
        assert.equal(ctx.status, 200, ctx.body);
        assert.equal(ctx.body, "metadata");
        assert.deepEqual(metadataCalls, [expected]);
        assert.equal(calls.length, 0);
        assert.equal(ctx.state.modTarget, undefined);
      }
    } finally { userLevel = 1; fileManager = true; }
  });
}
test("anonymous metadata is denied through actual authentication/limiter middleware", async () => {
  userLevel = 0;
  try {
    for (const [method, route, query, body] of metadataCases) {
      const ctx = await run(method, route, query, body);
      // Existing speedLimit throws for absent users; protocol reports that as 500.
      assert.equal(ctx.status, route === "search" ? 403 : 500, route);
      assertNoEffects();
    }
  } finally { userLevel = 1; }
});
test("metadata preserves parameter validation and session token/AJAX checks", async () => {
  for (const [method, route, query, body] of [
    ["GET", "versions", { source: "Modrinth" }, {}],
    ["GET", "versions", { projectId: "p" }, {}],
    ["GET", "info", {}, {}], ["POST", "batch_info", {}, {}],
    ["POST", "batch_info", {}, { hashes: {} }]
  ]) {
    assert.equal((await run(method, route, query, body)).status, 400, route);
    assertNoEffects();
  }
  assert.equal((await run("GET", "search", { token: "wrong" })).status, 403);
  assertNoEffects();
  assert.equal((await run("GET", "search", {}, {}, { headers: { "x-requested-with": "" } })).status, 403);
  assertNoEffects();
  for (const query of [{ offset: -1 }, { limit: 51 }]) {
    assert.equal((await run("GET", "search", query)).status, 500);
    assertNoEffects();
  }
});
test("metadata speed limit and search concurrency boundary remain active", async () => {
  assert.equal((await run("GET", "versions", { projectId: "p", source: "FTB" })).status, 200);
  assert.equal((await run("GET", "versions", { projectId: "p", source: "FTB" }, {},
    { keepRateLimits: true })).status, 500);
  assertNoEffects();
  // Provider fixture asserts that the real search concurrency mutex is held.
  assert.equal((await run("GET", "search")).status, 200);
  assert.equal(mutexIdMap.size, 0, "mutex released after request");
});
test("all mounted instance handlers use the authorized immutable target", async () => {
  for (const [method, route, event] of instanceRoutes) {
    const input = { ...ids, ...data };
    const ctx = await run(method, route, method === "GET" ? input : {},
      method === "POST" ? input : {});
    assert.equal(ctx.status, 200, route + ": " + ctx.body);
    assert.deepEqual(calls[0], ["authorize", "daemon", "owned"]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1][1], "daemon");
    assert.equal(calls[1][2], event);
    assert.equal(calls[1][3].instanceUuid, "owned");
    assert.ok(Object.isFrozen(ctx.state.modTarget));
    assert.throws(() => { ctx.state.modTarget = ids; }, TypeError);
    assert.throws(() => { ctx.state.modTarget.instanceUuid = "changed"; }, TypeError);
  }
  await run("POST", "stop_transfer", {}, { ...ids, ...data, type: "upload" });
  assert.equal(calls[1][2], "file/delete");
});
test("all instance routes reject missing IDs and never fall back to the other source", async () => {
  for (const [method, route] of instanceRoutes) {
    for (const key of ["uuid", "daemonId"]) {
      for (const missing of [undefined, null, ""]) {
        const primary = { ...ids, ...data, [key]: missing };
        const ctx = await run(method, route, method === "GET" ? primary : ids,
          method === "POST" ? primary : ids);
        assert.equal(ctx.status, 400, route);
        assertNoEffects();
      }
    }
  }
});
test("all instance routes reject conflicting IDs before ownership checks", async () => {
  for (const [method, route] of instanceRoutes) {
    for (const key of ["uuid", "daemonId"]) {
      const ctx = await run(method, route, { ...ids, [key]: "other" }, { ...ids, ...data });
      assert.equal(ctx.status, 400, route);
      assert.match(ctx.body, /Conflicting mod target IDs/);
      assertNoEffects();
    }
  }
});
test("malformed HTTP query and typed body IDs reject before authorization", async () => {
  for (const key of ["uuid", "daemonId"]) {
    // Duplicate query keys become arrays in Koa; a single query scalar is necessarily a string.
    for (const bad of [["owned", "other"], " "]) {
      assert.equal((await run("GET", "list", { ...ids, [key]: bad }, ids)).status, 400);
      assertNoEffects();
    }
    for (const bad of [["owned"], { id: "owned" }, 42, true, " "]) {
      for (const method of ["GET", "POST"]) {
        assert.equal((await run(method, method === "GET" ? "list" : "toggle",
          ids, { ...ids, ...data, [key]: bad })).status, 400);
        assertNoEffects();
      }
    }
  }
});
test("all instance routes deny unowned IDs without RPC", async () => {
  for (const [method, route] of instanceRoutes) {
    for (const key of ["uuid", "daemonId"]) {
      const input = { ...ids, ...data, [key]: "unowned" };
      assert.equal((await run(method, route, method === "GET" ? input : {},
        method === "POST" ? input : {})).status, 403, route);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], "authorize");
    }
  }
  allowed = false;
  try {
    for (const [method, route] of instanceRoutes) {
      assert.equal((await run(method, route, { ...ids, ...data }, { ...ids, ...data })).status, 403, route);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], "authorize");
    }
  } finally { allowed = true; }
});
test("file-manager policy protects every instance route and retains admin exception", async () => {
  fileManager = false;
  try {
    for (const [method, route] of instanceRoutes) {
      // Existing Error response is serialized as 500 by protocol.
      assert.equal((await run(method, route, { ...ids, ...data }, { ...ids, ...data })).status, 500, route);
      assertNoEffects();
      userLevel = 10;
      assert.equal((await run(method, route, { ...ids, ...data }, { ...ids, ...data })).status, 200, route);
      userLevel = 1;
    }
  } finally { fileManager = true; userLevel = 1; }
});
test("matching dual sources work and later mutation cannot retarget any instance RPC", async () => {
  mutate = true;
  try {
    for (const [method, route] of instanceRoutes) {
      assert.equal((await run(method, route, { ...ids, ...data }, { ...ids, ...data })).status, 200, route);
      assert.equal(calls[1][1], "daemon");
      assert.equal(calls[1][3].instanceUuid, "owned");
    }
  } finally { mutate = false; }
});
test("unknown paths and wrong methods keep router behavior without target/provider/RPC effects", async () => {
  for (const requestPath of ["/api/mod/unknown", "/api/mod/unknown/search", "/api/mod/search/extra",
    "/api/mod/other/list", "/mod/search", "/api/other/mod/search"]) {
    assert.equal((await run("GET", "", {}, {}, { path: requestPath })).status, 404, requestPath);
    assertNoEffects();
  }
  for (const [method, route, expectedAllow] of [
    ["POST", "search", ["HEAD", "GET"]], ["GET", "toggle", ["POST"]],
    ["PUT", "list", ["HEAD", "GET"]], ["GET", "batch_info", ["POST"]]
  ]) {
    const ctx = await run(method, route);
    assert.equal(ctx.status, 405, route);
    assert.deepEqual(ctx.headers.allow.split(/,\s*/).sort(), expectedAllow.sort());
    assertNoEffects();
  }
  for (const route of ["search", "list", "download"]) {
    const ctx = await run("OPTIONS", route);
    assert.equal(ctx.status, 200, route);
    assert.ok(ctx.headers.allow);
    assertNoEffects();
  }
});
test("HEAD metadata remains target-free and authenticated", async () => {
  try {
    for (const level of [1, 10, 0]) {
      userLevel = level;
      for (const [method, route, query, , expected] of metadataCases) {
        if (method !== "GET") continue;
        const ctx = await run("HEAD", route, query);
        assert.equal(ctx.body, "", "HEAD has no response body");
        if (level > 0) {
          assert.equal(ctx.status, 200, route);
          assert.deepEqual(metadataCalls, [expected]);
          assert.equal(calls.length, 0);
          assert.equal(ctx.state.modTarget, undefined);
        } else {
          assert.equal(ctx.status, route === "search" ? 403 : 500, route);
          assertNoEffects();
        }
      }
    }
  } finally { userLevel = 1; }
});
test("HEAD instance handlers authorize the same query target and RPC boundary as GET", async () => {
  try {
    for (const [, route] of instanceRoutes.filter(([method]) => method === "GET")) {
      const query = { ...ids, ...data };
      assert.equal((await run("GET", route, query)).status, 200);
      const expected = structuredClone(calls);
      mutate = true;
      const ctx = await run("HEAD", route, query);
      mutate = false;
      assert.equal(ctx.status, 200, route);
      assert.equal(ctx.body, "");
      assert.deepEqual(calls, expected);
      assert.ok(Object.isFrozen(ctx.state.modTarget));
      assert.throws(() => { ctx.state.modTarget = ids; }, TypeError);
      assert.equal(ctx.state.modTarget.instanceUuid, "owned");
    }
  } finally { mutate = false; }
});
test("HEAD instance routes reject missing query IDs without RPC", async () => {
  for (const route of ["list", "config_files"]) {
    for (const key of ["uuid", "daemonId"]) {
      const query = { ...ids, ...data };
      delete query[key];
      assert.equal((await run("HEAD", route, query)).status, 400, route);
      assertNoEffects();
    }
  }
});
test("HEAD instance routes reject conflicting repeated query IDs before authorization", async () => {
  // Production koa-body excludes HEAD, so contradictory IDs arrive as repeated query keys.
  for (const route of ["list", "config_files"]) {
    for (const key of ["uuid", "daemonId"]) {
      const query = { ...ids, ...data, [key]: [ids[key], "other"] };
      assert.equal((await run("HEAD", route, query)).status, 400, route);
      assertNoEffects();
    }
  }
});
test("HEAD instance routes deny unowned query targets without RPC", async () => {
  for (const route of ["list", "config_files"]) {
    for (const key of ["uuid", "daemonId"]) {
      const query = { ...ids, ...data, [key]: "unowned" };
      assert.equal((await run("HEAD", route, query)).status, 403, route);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], "authorize");
      assert.equal(metadataCalls.length, 0);
    }
  }
});
test("pure production resolver retains immutable method-specific targets", () => {
  const target = resolveModTarget("GET", ids, {});
  assert.deepEqual(target, { daemonId: "daemon", instanceUuid: "owned" });
  assert.ok(Object.isFrozen(target));
  assert.deepEqual(resolveModTarget("POST", {}, ids), target);
});
