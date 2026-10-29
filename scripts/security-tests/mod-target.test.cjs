"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
require("../../panel/node_modules/ts-node").register({
  project: path.resolve(__dirname, "../../panel/tsconfig.json"),
  transpileOnly: true
});
const calls = [];
const metadataCalls = [];
const roleChecks = [];
let allowed = true;
let fileManager = true;
let userLevel = 1;
let mutate = false;
const originalLoad = Module._load;
const mocks = {
  "../entity/user": { ROLE: { USER: 1 } },
  "../i18n": { $t: (s) => s },
  "../middleware/limit": {
    speedLimit: () => async (ctx, next) => {
      if (mutate) {
        ctx.query.uuid = "changed";
        ctx.request.body.uuid = "changed";
        ctx.query.daemonId = "changed";
        ctx.request.body.daemonId = "changed";
      }
      await next();
    },
    requestConcurrencyLimiter: () => async (ctx, next) => next()
  },
  "../middleware/permission": { default: ({ level }) => async (ctx, next) => {
    roleChecks.push(level);
    if (userLevel < level) { ctx.status = 403; return; }
    await next();
  }, __esModule: true },
  "../service/mod_manager_service": { modManagerService: new Proxy({}, {
    get: (_, method) => async (...args) => {
      metadataCalls.push([method, ...args]);
      return "metadata";
    }
  }) },
  "../service/passport_service": {
    getUserUuid: () => "user", getUserPermission: () => userLevel
  },
  "../service/permission_service": {
    isHaveInstanceByUuid: (user, daemon, uuid) => {
      calls.push(["authorize", daemon, uuid]);
      return allowed;
    }
  },
  "../service/remote_command": { __esModule: true, default: class {
    constructor(daemon) { this.daemon = daemon; }
    async request(event, payload) {
      calls.push(["rpc", this.daemon, event, payload]);
      return "ok";
    }
  } },
  "../service/remote_service": { __esModule: true, default: { getInstance: (id) => id } },
  "../setting": { systemConfig: { get canFileManager() { return fileManager; } } },
  "../utils/url": { checkSafeUrl: () => true }
};
Module._load = function(id, parent, ...args) {
  if (parent?.filename.endsWith(path.join("routers", "mod_manager_router.ts")) && mocks[id])
    return mocks[id];
  return originalLoad.call(this, id, parent, ...args);
};
let router;
try { router = require("../../panel/src/app/routers/mod_manager_router.ts").default; }
finally { Module._load = originalLoad; }
const { resolveModTarget } = require("../../panel/src/app/utils/mod_target.ts");
const ids = { daemonId: "daemon", uuid: "owned" };
async function run(method, route, query = {}, body = {}) {
  calls.length = 0;
  metadataCalls.length = 0;
  roleChecks.length = 0;
  const ctx = { method, path: "/mod/" + route, query: { ...query },
    request: { body: { ...body } }, state: {}, status: 200 };
  const layers = router.stack.filter(layer =>
    layer.match(ctx.path) && (!layer.methods.length || layer.methods.includes(method)));
  const stack = layers.flatMap(layer => layer.stack);
  assert.ok(stack.length > 1, "real route must be matched");
  const dispatch = async (i) => { if (stack[i]) await stack[i](ctx, () => dispatch(i + 1)); };
  await dispatch(0);
  return ctx;
}
const data = { fileName: "mod.jar", type: "download", url: "https://example.com/mod.jar",
  projectType: "mod", modId: "mod" };
test("real handlers use the authorized immutable target", async () => {
  for (const [method, route] of [
    ["GET", "list"], ["GET", "config_files"], ["POST", "download"],
    ["POST", "stop_transfer"], ["POST", "toggle"], ["POST", "delete"]
  ]) {
    const input = { ...ids, ...data };
    const ctx = await run(method, route, method === "GET" ? input : {},
      method === "POST" ? input : {});
    assert.equal(ctx.status, 200, route);
    assert.deepEqual(calls[0], ["authorize", "daemon", "owned"]);
    const rpc = calls.find(c => c[0] === "rpc");
    assert.ok(rpc, route);
    assert.equal(rpc[1], "daemon");
    assert.equal(rpc[3].instanceUuid, "owned");
    assert.ok(Object.isFrozen(ctx.state.modTarget));
    assert.throws(() => { ctx.state.modTarget = ids; }, TypeError);
  }
  await run("POST", "stop_transfer", {}, { ...ids, ...data, type: "upload" });
  assert.equal(calls[1][2], "file/delete");
});
test("matching dual sources accepted; conflicting or malformed sources fail before authorization", async () => {
  assert.equal((await run("POST", "toggle", ids, { ...ids, ...data })).status, 200);
  for (const key of ["uuid", "daemonId"]) {
    for (const bad of ["other", ["owned"], { id: "owned" }, 42, true, " "]) {
      for (const method of ["GET", "POST"]) {
        const ctx = await run(method, method === "GET" ? "list" : "toggle",
          { ...ids, [key]: bad }, { ...ids, ...data });
        assert.equal(ctx.status, 400);
        assert.equal(calls.length, 0);
      }
      const ctx = await run("POST", "toggle", ids, { ...ids, ...data, [key]: bad });
      assert.equal(ctx.status, 400);
      assert.equal(calls.length, 0);
    }
  }
});
test("missing method-specific IDs rejected without fallback", async () => {
  for (const method of ["GET", "POST"]) {
    for (const key of ["uuid", "daemonId"]) {
      for (const missing of [undefined, null, ""]) {
        const primary = { ...ids, [key]: missing, ...data };
        const ctx = await run(method, method === "GET" ? "list" : "toggle",
          method === "GET" ? primary : ids, method === "POST" ? primary : ids);
        assert.equal(ctx.status, 400);
        assert.equal(calls.length, 0);
      }
    }
  }
});
test("unauthorized and globally disabled requests never reach RPC", async () => {
  allowed = false;
  try {
    for (const [method, route] of [["GET", "list"], ["POST", "delete"]]) {
      assert.equal((await run(method, route, ids, { ...ids, ...data })).status, 403);
      assert.equal(calls.filter(c => c[0] === "rpc").length, 0);
    }
  } finally { allowed = true; }
  fileManager = false;
  try {
    assert.equal((await run("GET", "list", ids)).status, 403);
    assert.equal(calls.length, 0);
    userLevel = 10;
    assert.equal((await run("GET", "list", ids)).status, 200);
  } finally { fileManager = true; userLevel = 1; }
});
test("later request mutation cannot retarget RPC", async () => {
  mutate = true;
  try {
    for (const [method, route] of [["GET", "list"], ["POST", "toggle"]]) {
      await run(method, route, ids, { ...ids, ...data });
      assert.equal(calls[1][1], "daemon");
      assert.equal(calls[1][3].instanceUuid, "owned");
    }
  } finally { mutate = false; }
});
test("intentional metadata routes remain target-free", async () => {
  for (const [method, route, query, body] of [
    ["GET", "mc_versions", {}, {}], ["GET", "search", {}, {}],
    ["GET", "info", { hash: "hash" }, {}], ["POST", "batch_info", {}, { hashes: [] }]
  ]) {
    assert.equal((await run(method, route, query, body)).status, 200);
    assert.equal(calls.length, 0);
  }

});
test("versions metadata accepts admins and regular users without target IDs and preserves validation", async () => {
  try {
    for (const level of [1, 10]) {
      userLevel = level;
      const ctx = await run("GET", "versions", { projectId: "p", source: "Modrinth" });
      assert.equal(ctx.status, 200);
      assert.equal(ctx.body, "metadata");
      assert.deepEqual(metadataCalls, [["getProjectVersions", "p", "Modrinth"]]);
      assert.deepEqual(roleChecks, [1]);
      assert.equal(calls.length, 0, "no ownership check or instance RPC");
      assert.equal(ctx.state.modTarget, undefined);
      for (const query of [{ source: "Modrinth" }, { projectId: "p" }]) {
        assert.equal((await run("GET", "versions", query)).status, 400);
        assert.deepEqual(roleChecks, [1]);
        assert.equal(metadataCalls.length, 0);
        assert.equal(calls.length, 0);
      }
    }
    userLevel = 0;
    assert.equal((await run("GET", "versions", { projectId: "p", source: "Modrinth" })).status, 403);
    assert.equal(metadataCalls.length, 0);
    assert.equal(calls.length, 0);
  } finally { userLevel = 1; }
});
test("pure production resolver returns an immutable method-specific target", () => {
  assert.deepEqual(resolveModTarget("GET", ids, {}), { daemonId: "daemon", instanceUuid: "owned" });
  assert.deepEqual(resolveModTarget("POST", {}, ids), { daemonId: "daemon", instanceUuid: "owned" });
});
