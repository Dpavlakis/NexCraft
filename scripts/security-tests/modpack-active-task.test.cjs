"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "../..");
const panelRequire = Module.createRequire(path.join(root, "panel/package.json"));
const ts = panelRequire("typescript");

// Compile actual modules with controlled I/O boundaries, without starting either server.
function loadTs(file, imports) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", source)(imports, module, module.exports);
  return module.exports;
}
const unexpected = (id) => { throw new Error(`Unexpected dependency: ${id}`); };
const asDefault = (value) => ({ __esModule: true, default: value });
const translate = { $t: (key) => key };
const tasks = loadTs("daemon/src/service/async_task_service/index.ts", (id) => {
  if (id === "events") return require("node:events");
  if (id === "../log") return asDefault({ info() {}, error() {} });
  return unexpected(id);
});
const { TaskCenter } = tasks;
const operationProgress = loadTs("daemon/src/service/async_task_service/operation_progress.ts", unexpected);
// These imports are inert: construct fixtures from the real prototypes, never install/update files.
function taskImports(id) {
  if (id === "./index") return tasks;
  if (id === "./operation_progress") return operationProgress;
  return {};
}
const { ModpackUpdateTask } = loadTs("daemon/src/service/async_task_service/modpack_update_task.ts", taskImports);
const { ModpackInstallTask } = loadTs("daemon/src/service/async_task_service/modpack_install_task.ts", taskImports);
const handlers = new Map();
const instances = new Map();
let lookups = [];
loadTs("daemon/src/routers/modpack_router.ts", (id) => {
  if (id === "../service/mc_port") return { validateGamePort: unexpected };
  if (id === "../i18n") return translate;
  if (id === "../service/async_task_service/index") return tasks;
  if (id.endsWith("/modpack_update_task")) return { ModpackUpdateTask };
  if (id.endsWith("/modpack_install_task")) return { ModpackInstallTask };
  if (id === "../service/router") return { routerApp: { on: (event, handler) => handlers.set(event, handler) } };
  if (id === "../service/protocol") return {
    response: (ctx, value) => { ctx.value = value; },
    responseError: (ctx, error) => { ctx.error = error; }
  };
  if (id === "../service/system_instance") return asDefault({ getInstance: (uuid) => {
    lookups.push(uuid);
    return instances.get(uuid);
  } });
  return unexpected(id);
});
const forbiddenMutation = () => { throw new Error("Read-only lookup attempted a mutation"); };
for (const method of ["addTask", "deleteAllStoppedTask", "onTaskStopped", "onTaskError"])
  TaskCenter[method] = forbiddenMutation;
function instance(uuid = "target") {
  return Object.freeze({ instanceUuid: uuid, config: Object.freeze({ nickname: uuid }), status: () => 2 });
}
function task(inst, { install = false, status = 1, type, source = "modrinth", resetMode } = {}) {
  const proto = install ? ModpackInstallTask.prototype : ModpackUpdateTask.prototype;
  const value = Object.assign(Object.create(proto), {
    instance: inst,
    type: type ?? (install ? ModpackInstallTask.TYPE : ModpackUpdateTask.TYPE),
    taskId: `${install ? "install" : "update"}-${inst.instanceUuid}-${status}`,
    _status: status,
    descriptor: Object.freeze({ source, mrpackUrl: "https://private.invalid/secret", apiKey: "secret" }),
    resetMode,
    phase: "download",
    start: forbiddenMutation, stop: forbiddenMutation, onStart: forbiddenMutation, onStop: forbiddenMutation
  });
  if (install) value.downloadProgress = Object.freeze({ percentage: 35, downloadedBytes: 35, totalBytes: 100 });
  else Object.defineProperty(value, "progress", { value: Object.freeze(operationProgress.measuredProgress("download", 35, 100)) });
  return Object.freeze(value);
}
function fixture(inst, values = []) {
  instances.clear();
  instances.set(inst.instanceUuid, inst);
  TaskCenter.tasks = Object.freeze(values);
  lookups = [];
}
function discover(data = { instanceUuid: "target" }) {
  const ctx = {};
  handlers.get("modpack/active_task")(ctx, data);
  return ctx;
}
function statusSubset(snapshot) {
  const { taskId, status, instanceUuid, instanceStatus, phase, progress, downloadProgress } = snapshot;
  return { taskId, status, instanceUuid, instanceStatus, phase, progress, downloadProgress };
}
function poll(taskId) {
  const ctx = {};
  handlers.get("modpack/task_status")(ctx, { taskId });
  return ctx.value;
}

test("discovers the current running modpack update with the existing task_status status/progress fields", () => {
  const inst = instance();
  const update = task(inst);
  fixture(inst, [update]);
  const result = discover();
  assert.deepEqual(result, { value: statusSubset(poll(update.taskId)) });
  assert.equal(result.value.progress.percentage, 35);
  assert.equal(result.value.status, 1);
  assert.equal(result.value.instanceUuid, inst.instanceUuid);
  assert.equal(result.value.phase, "download");
  assert.deepEqual(lookups, ["target"]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal("descriptor" in result.value, false);
});

test("filters exact instance identity, UUID, task type and strictly running status", () => {
  const inst = instance();
  const ignored = [
    task(instance("other")),
    task(instance()), // deleted/replaced instance with the same UUID
    task(inst, { type: "BackupTask" }),
    task(inst, { type: "RestoreTask" }),
    task(inst, { type: "WorldReplaceTask" }),
    task(inst, { type: "WorldResetTask" }),
    task(inst, { type: "ModpackUpdateTask-extra" }),
    ...[0, -1, 2, "1"].map((status) => task(inst, { status }))
  ];
  const update = task(inst);
  fixture(inst, [...ignored, update]);
  assert.deepEqual(discover(), { value: statusSubset(update.toObject()) });
  fixture(inst, ignored);
  assert.deepEqual(discover(), { value: null });
});

test("discovers BDS preserve-world updates but excludes fresh installs and other reinstalls", () => {
  const inst = instance();
  const ignored = [
    task(inst, { install: true, source: "bedrock" }),
    task(inst, { install: true, source: "bedrock", resetMode: "wipe" }),
    task(inst, { install: true, source: "bedrock", resetMode: "backup_wipe" }),
    task(inst, { install: true, source: "modrinth", resetMode: "preserve_world" }),
    task(inst, { install: true, source: "bedrock", resetMode: "preserve_world", status: 0 }),
    task(inst, { install: true, source: "bedrock", resetMode: "preserve_world", status: -1 }),
    task(instance(), { install: true, source: "bedrock", resetMode: "preserve_world" }),
    task(instance("other"), { install: true, source: "bedrock", resetMode: "preserve_world" })
  ];
  fixture(inst, ignored);
  assert.deepEqual(discover(), { value: null });
  const bds = task(inst, { install: true, source: "bedrock", resetMode: "preserve_world" });
  fixture(inst, [...ignored, bds]);
  assert.deepEqual(discover(), { value: statusSubset(poll(bds.taskId)) });
  assert.equal(discover().value.downloadProgress.percentage, 35);
  assert.equal("instanceConfig" in discover().value, false);
  assert.deepEqual(poll(bds.taskId).instanceConfig, inst.config);
  assert.equal(JSON.stringify(discover()).includes("secret"), false);
});

test("malformed or missing instance is an error; only a valid idle instance returns null", () => {
  fixture(instance());
  for (const data of [undefined, null, {}, { instanceUuid: "" }, { instanceUuid: "  " },
    { instanceUuid: 42 }, { instanceUuid: [] }, { instanceUuid: {} }, { instanceUuid: "missing" }]) {
    const ctx = discover(data === undefined ? {} : data);
    assert.ok(ctx.error instanceof Error);
    assert.equal("value" in ctx, false);
  }
  // An inconsistent subsystem result must not attach a different UUID.
  instances.set("alias", instances.get("target"));
  assert.ok(discover({ instanceUuid: "alias" }).error instanceof Error);
  assert.deepEqual(discover(), { value: null });
});

test("repeated discovery neither schedules nor changes retained tasks; legacy polling keeps terminal tasks", () => {
  const inst = instance();
  const done = task(inst, { status: 0 });
  const active = task(inst);
  fixture(inst, [done, active]);
  const retained = TaskCenter.tasks;
  for (let i = 0; i < 3; i++) assert.deepEqual(discover(), { value: statusSubset(active.toObject()) });
  assert.equal(TaskCenter.tasks, retained);
  assert.equal(TaskCenter.tasks.length, 2);
  assert.equal(active.status(), 1);
  assert.deepEqual(poll(done.taskId), done.toObject());
  assert.equal(poll("not-retained"), null);
});

const { ROLE } = loadTs("panel/src/app/entity/user.ts", unexpected);
const permission = loadTs("panel/src/app/middleware/permission.ts", (id) => {
  if (id === "mcsmanager-common") return { GlobalVariable: { get: () => 0, set() {} } };
  if (id === "../i18n") return translate;
  if (id === "../service/passport_service") return {
    getUuidByApiKey: (key) => key === "admin" ? { permission: ROLE.ADMIN } : { permission: ROLE.USER },
    isAjax: () => true, logout: (ctx) => { ctx.status = 403; }
  };
  if (id === "../service/session_store") return {
    browserRequestAdmission: () => true, liveBrowserUser: (ctx) => ctx.testUser
  };
  return unexpected(id);
}).default;
const validator = loadTs("panel/src/app/middleware/validator.ts", unexpected).default;
let calls = [];
let remoteResult = null;
let remoteError;
const router = loadTs("panel/src/app/routers/modpack_router.ts", (id) => {
  if (id === "@koa/router") return panelRequire(id);
  if (id === "axios") return asDefault({});
  if (id === "../entity/user") return { ROLE };
  if (id === "../i18n") return translate;
  if (id === "../middleware/permission") return asDefault(permission);
  if (id === "../middleware/validator") return asDefault(validator);
  if (id === "../middleware/limit") return { requestConcurrencyLimiter: () => async (ctx, next) => next() };
  if (id === "../service/mod_manager_service") return { modManagerService: {} };
  if (id === "../service/operation_logger") return { operationLogger: { log: forbiddenMutation } };
  if (id === "../service/remote_service") return asDefault({ getInstance: (daemonId) => {
    calls.push({ daemonId }); return { daemonId };
  } });
  if (id === "../service/remote_command") return asDefault(class {
    constructor(target) { this.target = target; }
    async request(event, data) {
      calls.push({ target: this.target, event, data });
      if (remoteError) throw remoteError;
      return remoteResult;
    }
  });
  return unexpected(id);
}).default;
const layer = (name) => router.stack.find((route) => route.path === `/protected_modpack/${name}`);
async function request(name, level, query, authenticated = true) {
  calls = [];
  const ctx = {
    query: { token: "token", ...query }, request: { header: {} },
    session: { login: authenticated, uuid: "user", userName: "user", token: "token" },
    testUser: authenticated ? { permission: level } : undefined
  };
  const stack = layer(name).stack;
  const dispatch = (i) => stack[i]?.(ctx, () => dispatch(i + 1));
  await dispatch(0);
  return ctx;
}

test("panel active_task uses the update ADMIN gate and exposes only GET/HEAD", async () => {
  assert.deepEqual(layer("active_task").methods.slice().sort(), ["GET", "HEAD"]);
  const query = { daemonId: "node-a", uuid: "target" };
  for (const level of [ROLE.BAN, ROLE.GUEST, ROLE.USER]) {
    for (const name of ["active_task", "update"]) {
      assert.equal((await request(name, level, query)).status, 403);
      assert.deepEqual(calls, []);
    }
  }
  assert.equal((await request("active_task", ROLE.ADMIN, query, false)).status, 403);
  assert.deepEqual(calls, []);
});

test("panel validates required target and proxies exactly the selected daemon and UUID", async () => {
  for (const query of [{}, { daemonId: "node-a" }, { uuid: "target" },
    { daemonId: "", uuid: "target" }, { daemonId: "node-a", uuid: "" }]) {
    assert.equal((await request("active_task", ROLE.ADMIN, query)).status, 400);
    assert.deepEqual(calls, []);
  }
  remoteResult = { taskId: "existing", instanceUuid: "target", status: 1, phase: "download" };
  for (const [daemonId, uuid] of [["node-a", "target"], ["node-b", "other"]]) {
    const ctx = await request("active_task", ROLE.ADMIN, { daemonId, uuid, task_id: "ignored" });
    assert.deepEqual(ctx.body, { task: remoteResult });
    assert.deepEqual(calls, [{ daemonId }, {
      target: { daemonId }, event: "modpack/active_task", data: { instanceUuid: uuid }
    }]);
  }
  remoteResult = null;
  assert.deepEqual((await request("active_task", ROLE.ADMIN, { daemonId: "node-a", uuid: "target" })).body, { task: null });
  remoteError = new Error("instance missing");
  assert.equal((await request("active_task", ROLE.ADMIN, { daemonId: "node-a", uuid: "gone" })).body, remoteError);
  remoteError = undefined;
});

test("existing panel task_status remains USER-accessible with the same RPC payload", async () => {
  const result = await request("task_status", ROLE.USER, { daemonId: "node-a", task_id: "retained" });
  assert.notEqual(result.status, 403);
  assert.deepEqual(calls, [{ daemonId: "node-a" }, {
    target: { daemonId: "node-a" }, event: "modpack/task_status", data: { taskId: "retained" }
  }]);
});

// Exercise the actual protocol middleware over HTTP; a plain ctx misses its null => 500 rule.
const { once } = require("node:events");
const securityErrors = loadTs("panel/src/app/service/security_error.ts", unexpected);
const protocol = loadTs("panel/src/app/middleware/protocol.ts", (id) => {
  if (id === "../service/security_error") return securityErrors;
  if (id === "stream") return require("node:stream");
  if (id === "../service/visual_data") return asDefault({ addRequestCount() {} });
  if (id === "../setting") return { systemConfig: {} };
  if (id === "../version") return { getVersion: () => "test" };
  return unexpected(id);
}).middleware;
async function httpFixture(t) {
  calls = [];
  remoteResult = null;
  remoteError = undefined;
  const Koa = panelRequire("koa");
  const app = new Koa();
  app.use(protocol);
  app.use(async (ctx, next) => {
    ctx.session = { login: true, uuid: "user", userName: "user", token: "token" };
    ctx.testUser = { permission: ROLE.ADMIN };
    // Mount the same protected router beneath /api as in the panel.
    ctx.url = ctx.url.replace(/^\/api/, "");
    await next();
  });
  app.use(router.routes());
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  return async (query = { daemonId: "node-a", uuid: "target" }, key = "admin") => {
    calls = [];
    const url = new URL("/api/protected_modpack/active_task", "http://127.0.0.1:" + server.address().port);
    url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, { headers: { "x-request-api-key": key } });
    return { status: response.status, body: await response.json() };
  };
}

test("active_task idle is HTTP 200 with explicit data.task null through the real protocol", async (t) => {
  const get = await httpFixture(t);
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 200);
  assert.deepEqual(response.body.data, { task: null });
  assert.equal(typeof response.body.time, "number");
  assert.deepEqual(calls, [{ daemonId: "node-a" }, {
    target: { daemonId: "node-a" }, event: "modpack/active_task", data: { instanceUuid: "target" }
  }]);
});

test("active_task HTTP preserves running tasks and does not turn errors or malformed results into idle", async (t) => {
  const get = await httpFixture(t);
  remoteResult = { taskId: "existing", instanceUuid: "target", status: 1, phase: "download" };
  const running = await get();
  assert.equal(running.status, 200);
  assert.deepEqual(running.body.data, { task: remoteResult });

  remoteError = new Error("daemon offline");
  const offline = await get();
  assert.equal(offline.status, 500);
  assert.equal(offline.body.status, 500);
  assert.equal(offline.body.data, "daemon offline");
  remoteError = undefined;

  const forbidden = await get(undefined, "user");
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.status, 403);
  assert.deepEqual(calls, []);
  const invalid = await get({ daemonId: "node-a" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.status, 400);
  assert.deepEqual(calls, []);

  for (const malformed of [undefined, {}, false, "invalid", []]) {
    remoteResult = malformed;
    const response = await get();
    assert.equal(response.status, 200);
    assert.notDeepEqual(response.body.data, { task: null });
    assert.deepEqual(response.body.data, malformed === undefined ? {} : { task: malformed });
  }
});
