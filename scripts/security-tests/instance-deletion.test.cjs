"use strict";

// Mount the current router, validator, permission and protocol modules in Koa.
// Only daemon RPC, user persistence and unrelated services are fixture boundaries.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const { once } = require("node:events");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const base = path.join(root, "panel/src/app");
const dep = createRequire(path.join(root, "panel/package.json"));
const ts = dep("typescript");

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function fixture(t, respond) {
  const remoteCalls = [],
    cleanupCalls = [],
    logs = [],
    trace = [];
  const started = deferred();
  const access = [
    {
      user: "one",
      instances: [
        { daemonId: "node-a", instanceUuid: "a" },
        { daemonId: "node-a", instanceUuid: "b" },
        { daemonId: "node-b", instanceUuid: "a" }
      ]
    },
    {
      user: "two",
      instances: [
        { daemonId: "node-a", instanceUuid: "a" },
        { daemonId: "node-a", instanceUuid: "b" }
      ]
    }
  ];
  const initialAccess = structuredClone(access);
  const mocks = new Map(),
    cache = new Map();
  const mock = (name, value) => mocks.set(path.join(base, name + ".ts"), value);
  mock("entity/user", { ROLE: { USER: 1, ADMIN: 10 } });
  mock("const", {});
  mock("i18n", { $t: (key) => key });
  mock("setting", { systemConfig: {} });
  mock("version", { getVersion: () => "deletion-fixture" });
  mock("service/game_endpoint", {});
  mock("service/instance_service", {});
  mock("service/log", { logger: {} });
  mock("service/visual_data", { addRequestCount() {} });
  mock("service/password", {});
  mock("service/permission_service", {});
  mock("service/passport_service", {
    getUserUuid: () => "fixture",
    getUuidByApiKey: () => undefined,
    isAjax: (ctx) => ctx.get("X-Requested-With") === "XMLHttpRequest",
    logout: (ctx) => {
      ctx.status = 403;
    },
    ILLEGAL_ACCESS_KEY: "fixture-illegal"
  });
  mock("service/session_store", {
    browserRequestAdmission: () => true,
    liveBrowserUser: (ctx) => ({ permission: Number(ctx.get("X-Fixture-Role") || 10) })
  });
  mock("service/remote_service", { getInstance: (daemonId) => ({ daemonId }) });
  mock(
    "service/remote_command",
    class RemoteRequest {
      constructor(remote) {
        this.remote = remote;
      }
      async request(event, data) {
        const call = { daemonId: this.remote.daemonId, event, data: structuredClone(data) };
        remoteCalls.push(call);
        trace.push("rpc-start");
        started.resolve();
        const result = await respond(call);
        trace.push("rpc-ack");
        return result;
      }
    }
  );
  mock("service/user_service", {
    async deleteUserInstances(user, ids, allUsers) {
      trace.push("cleanup");
      cleanupCalls.push({ user, ids: structuredClone(ids), allUsers });
      for (const record of access)
        record.instances = record.instances.filter(
          (instance) =>
            !ids.some(
              (id) => id.daemonId === instance.daemonId && id.instanceUuid === instance.instanceUuid
            )
        );
    }
  });
  mock("service/operation_logger", {
    operationLogger: {
      log(...args) {
        trace.push("log");
        logs.push(args);
      }
    }
  });
  function source(filename) {
    if (mocks.has(filename)) return mocks.get(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText;
    vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename })(
      (name) => {
        if (name === "mcsmanager-common")
          return { GlobalVariable: { get: (_key, fallback) => fallback, set() {} } };
        if (name === "axios" || name === "fs-extra") return {};
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
  app.on("error", () => {});
  app.use(src("middleware/protocol").middleware);
  app.use(async (ctx, next) => {
    ctx.session = { login: true, uuid: "fixture", userName: "fixture", token: "fixture-token" };
    const chunks = [];
    for await (const chunk of ctx.req) chunks.push(chunk);
    ctx.request.body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    await next();
  });
  const router = new (dep("@koa/router"))({ prefix: "/api" });
  router.use(src("routers/instance_admin_router").default.routes());
  app.use(router.routes());
  const server = http.createServer(app.callback());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      })
  );
  async function request(body = { uuids: ["a", "b"], deleteFile: false }, options = {}) {
    const response = await fetch(
      "http://127.0.0.1:" +
        server.address().port +
        "/api/instance?daemonId=" +
        (options.daemonId || "node-a") +
        "&token=fixture-token",
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-Fixture-Role": String(options.role ?? 10)
        },
        body: JSON.stringify(body)
      }
    );
    return { status: response.status, body: await response.json() };
  }
  return {
    request,
    started: started.promise,
    access,
    initialAccess,
    remoteCalls,
    cleanupCalls,
    logs,
    trace
  };
}

test("mounted delete waits for daemon acknowledgement and cleans only confirmed requested access", async (t) => {
  const daemon = deferred(),
    result = {
      instanceUuids: ["a", "b"],
      instances: [{ instanceUuid: "a", nickname: "Server A" }]
    };
  const f = await fixture(t, () => daemon.promise);
  const response = f.request();
  await Promise.race([f.started, response]);
  assert.equal(f.remoteCalls.length, 1);
  assert.deepEqual(f.access, f.initialAccess);
  assert.deepEqual(f.cleanupCalls, []);
  daemon.resolve(result);
  const reply = await response;
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.data, result);
  assert.deepEqual(f.cleanupCalls, [
    { user: null, ids: [{ instanceUuid: "a", daemonId: "node-a" }], allUsers: true }
  ]);
  assert.deepEqual(f.access, [
    {
      user: "one",
      instances: [
        { daemonId: "node-a", instanceUuid: "b" },
        { daemonId: "node-b", instanceUuid: "a" }
      ]
    },
    { user: "two", instances: [{ daemonId: "node-a", instanceUuid: "b" }] }
  ]);
  assert.deepEqual(f.trace, ["rpc-start", "rpc-ack", "cleanup", "log"]);
  assert.deepEqual(f.remoteCalls, [
    {
      daemonId: "node-a",
      event: "instance/delete",
      data: { instanceUuids: ["a", "b"], deleteFile: false }
    }
  ]);
  assert.equal(f.logs.length, 1);
  assert.equal(f.logs[0][1].instance_id, "a");
});

test("mounted delete preserves the file-deletion flag and deduplicates only confirmed requested UUIDs", async (t) => {
  const result = {
    instanceUuids: ["a", "a", "b"],
    instances: [
      { instanceUuid: "a", nickname: "A" },
      { instanceUuid: "a", nickname: "duplicate" },
      { instanceUuid: "unrequested", nickname: "Other" },
      { instanceUuid: "b", nickname: "B" }
    ]
  };
  const f = await fixture(t, () => result);
  const reply = await f.request({ uuids: ["a", "a", "b"], deleteFile: true });
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.data, result);
  assert.equal(f.remoteCalls[0].data.deleteFile, true);
  assert.deepEqual(f.cleanupCalls[0].ids, [
    { instanceUuid: "a", daemonId: "node-a" },
    { instanceUuid: "b", daemonId: "node-a" }
  ]);
  assert.deepEqual(
    f.logs.map((log) => log[1].instance_id),
    ["a", "b"]
  );
  assert.deepEqual(f.access, [
    { user: "one", instances: [{ daemonId: "node-b", instanceUuid: "a" }] },
    { user: "two", instances: [] }
  ]);
});

for (const [name, result] of [
  ["empty confirmed list", { instanceUuids: ["a", "b"], instances: [] }],
  ["request echo without confirmed list", { instanceUuids: ["a", "b"] }],
  [
    "unrequested confirmed UUID",
    { instanceUuids: ["a", "b"], instances: [{ instanceUuid: "other", nickname: "Other" }] }
  ],
  ["null result", null],
  ["missing result", undefined],
  ["legacy boolean", true],
  ["legacy array", ["a"]],
  ["malformed list", { instances: { instanceUuid: "a" } }],
  ["malformed entries", { instances: [null, {}, { instanceUuid: 1 }] }]
])
  test("mounted delete retains access on " + name, async (t) => {
    const f = await fixture(t, () => result);
    await f.request();
    assert.deepEqual(f.access, f.initialAccess);
    assert.deepEqual(f.cleanupCalls, []);
    assert.deepEqual(f.logs, []);
  });

test("mounted delete keeps all access and reports the actual daemon rejection", async (t) => {
  const f = await fixture(t, () => {
    throw Error("daemon deletion rejected");
  });
  const reply = await f.request();
  assert.equal(reply.status, 500);
  assert.equal(reply.body.data, "daemon deletion rejected");
  assert.deepEqual(f.access, f.initialAccess);
  assert.deepEqual(f.cleanupCalls, []);
  assert.deepEqual(f.logs, []);
});

test("mounted delete applies acknowledgement only to the requested daemon", async (t) => {
  const f = await fixture(t, () => ({
    instanceUuids: ["a"],
    instances: [{ instanceUuid: "a", nickname: "Other node A" }]
  }));
  await f.request({ uuids: ["a"], deleteFile: false }, { daemonId: "node-b" });
  assert.deepEqual(f.cleanupCalls[0].ids, [{ instanceUuid: "a", daemonId: "node-b" }]);
  assert.deepEqual(f.access[0].instances, [
    { daemonId: "node-a", instanceUuid: "a" },
    { daemonId: "node-a", instanceUuid: "b" }
  ]);
  assert.deepEqual(f.access[1], f.initialAccess[1]);
});

test("mounted delete retains existing admin permission and request validation", async (t) => {
  const f = await fixture(t, () => {
    throw Error("RPC must not be called");
  });
  assert.equal((await f.request(undefined, { role: 1 })).status, 403);
  assert.equal((await f.request({ uuids: ["a"] })).status, 400);
  assert.equal((await f.request({ uuids: "a", deleteFile: false })).status, 500);
  assert.deepEqual(f.remoteCalls, []);
  assert.deepEqual(f.cleanupCalls, []);
  assert.deepEqual(f.access, f.initialAccess);
});
