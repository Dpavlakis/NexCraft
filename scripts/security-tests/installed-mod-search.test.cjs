"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const Module = require("node:module");
const root = path.resolve(__dirname, "../..");
const panelRequire = Module.createRequire(path.join(root, "panel/package.json"));
const ts = panelRequire("typescript");
const asDefault = value => ({ __esModule: true, default: value });
const unexpected = id => { throw new Error(`Unexpected dependency/call: ${id}`); };
function loadTs(file, imports, timers = { setInterval }) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "setInterval", source)(imports, mod, mod.exports, timers.setInterval);
  return mod.exports;
}

// Exercise the real listMods scan/cache/filter/sort/page path with in-memory filesystem
// and metadata boundaries. No jars, providers, instance servers or NAS are accessed.
const fixtureRoot = path.resolve(root, "fixture-instance");
const files = new Map();
function add(folder, file, name, extra = {}) {
  files.set(path.join(fixtureRoot, folder, file), { folder, file, name, ...extra });
}
for (let i = 0; i < 220; i++) {
  const number = String(i).padStart(3, "0");
  add("mods", `base-${number}.jar${i % 10 === 0 ? ".disabled" : ""}`, `A${number}`);
}
add("mods", "bread-alert.jar", "Toast Notifications");
add("mods", "disabled-toast.jar.disabled", "ZDisabled");
add("mods", "Unparsed-Toast.jar.disabled", undefined, { statError: true });
add("mods", "odd.[toast]+.jar", "ZLiteral");
add("mods", "tie-b.jar", "Twin");
add("mods", "tie-a.jar", "Twin");
add("plugins", "tie-p.jar", "Twin");
add("plugins", "plugin-file-match.jar", "PluginOnly");
for (let i = 0; i < 85; i++) add("plugins", `plugin-${i}.jar`, `ZPlugin ${i}`);
const scanPaths = [];
let reverse = false;
const fixtureFs = {
  pathExists: async dir => {
    scanPaths.push(dir);
    return ["mods", "plugins"].some(folder => dir === path.join(fixtureRoot, folder));
  },
  readdir: async dir => {
    const names = [...files.entries()].filter(([p]) => path.dirname(p) === dir).map(([, v]) => v.file);
    return [...(reverse ? names : names.reverse()), "readme.txt"];
  },
  stat: async file => {
    const entry = files.get(file);
    assert.ok(entry, file);
    if (entry.statError) throw new Error("unreadable fixture");
    return { mtimeMs: 1, size: 10 };
  }
};
const instance = { config: { type: "minecraft/java", fileCode: "utf8" }, absoluteCwdPath: () => fixtureRoot };
const instances = { getInstance: uuid => { assert.equal(uuid, "owned"); return instance; }, exists: uuid => uuid === "owned" };
class FileManager {
  constructor(cwd) { assert.equal(cwd, fixtureRoot); }
  toAbsolutePath(relative = ".") { return path.resolve(fixtureRoot, relative); }
  checkPath(file) { return file.startsWith(fixtureRoot + path.sep); }
}
const downloads = {
  tasks: [
    { id: "inside", path: path.join(fixtureRoot, "mods", "pending.jar"), total: 10, current: 2, status: 0 },
    { id: "outside", path: path.resolve(root, "another-instance", "pending.jar") }
  ], downloadingCount: 2
};
const { ModService } = loadTs("daemon/src/service/mod_service.ts", id => {
  if (id === "fs-extra") return asDefault(fixtureFs);
  if (id === "path") return asDefault(path);
  if (id === "crypto") return asDefault(require("node:crypto"));
  if (id === "node-stream-zip" || id === "smol-toml" || id === "yaml") return {};
  if (id === "./download_manager") return asDefault(downloads);
  if (id === "./mcdr_service") return { resolveMCDRServerRoot: () => undefined };
  if (id === "./system_instance") return asDefault(instances);
  if (id === "./system_file") return asDefault(FileManager);
  if (id === "./log") return asDefault({ info() {} });
  return unexpected(id);
});
let metadataReads = 0;
let active = 0;
let peak = 0;
function newService() {
  const service = new ModService();
  service.parseJarMetadata = async file => {
    metadataReads++;
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    const entry = files.get(file);
    return { name: entry.name, id: entry.file, type: entry.folder === "mods" ? "mod" : "plugin" };
  };
  service.getFileHash = async file => { assert.ok(files.has(file)); return "fixture-sha1"; };
  return service;
}
const service = newService();
const handlers = new Map();
const rpcMiddleware = [];
loadTs("daemon/src/routers/Instance_router.ts", id => {
  if (id === "../service/router") return { routerApp: {
    on: (event, handler) => handlers.set(event, handler), use: handler => rpcMiddleware.push(handler)
  } };
  if (id === "../service/protocol") return {
    response: (ctx, value) => { ctx.value = value; },
    responseError: (ctx, err) => { throw err; },
    error: (ctx, event, value) => { ctx.error = value; }, ROLE: { USER: 1, ADMIN: 10 }
  };
  if (id === "../service/system_instance") return asDefault(instances);
  if (id === "../service/system_file") return asDefault(FileManager);
  if (id === "../service/mod_service") return { modService: service };
  if (id === "../service/download_manager") return asDefault(downloads);
  if (id === "../service/upload_manager") return asDefault({ getUploads: () => new Map([
    ["upload", { cwd: "owned", path: "owned/mods/upload.jar", size: 20, received: [{ start: 0, end: 5 }] }],
    ["other", { cwd: "other", path: "other/mods/hidden.jar", size: 20, received: [] }]
  ]) });
  if (id === "path") return asDefault(path);
  // Other instance endpoints only register callbacks; they must never run here.
  return {};
});
async function rpc(data) {
  const ctx = {};
  let passed = false;
  rpcMiddleware[0]("instance/mods/list", ctx, data, () => { passed = true; });
  if (passed) await handlers.get("instance/mods/list")(ctx, data);
  return ctx;
}

// Mount the actual panel router with actual permission, limiter, validator and target
// resolver modules, replacing only identity/storage/RPC/provider boundaries.
let level = 1;
let allow = true;
let fileManagerEnabled = true;
let mutateTarget = false;
const calls = [];
const limits = new Map();
const globals = new Map();
const user = () => level ? { uuid: "user", userName: "tester", permission: level } : undefined;
const passport = {
  getUserUuid: ctx => ctx.session.uuid || "",
  getUserPermission: () => level,
  getUserFromCtx: ctx => {
    if (mutateTarget) Object.assign(ctx.query, { daemonId: "changed", uuid: "changed" });
    return user();
  },
  isAjax: ctx => ctx.get("x-requested-with") === "XMLHttpRequest",
  getUuidByApiKey: () => undefined, ILLEGAL_ACCESS_KEY: "illegal", logout: unexpected
};
const common = { GlobalVariable: {
  get: (key, fallback) => globals.get(key) ?? fallback, set: (key, value) => globals.set(key, value)
} };
const translate = { $t: key => key };
const middlewareImports = id => {
  if (id === "../entity/user") return { ROLE: { USER: 1, ADMIN: 10 } };
  if (id === "../i18n") return translate;
  if (id === "../service/passport_service") return passport;
  if (id === "../service/session_store") return { browserRequestAdmission: () => undefined, liveBrowserUser: user };
  if (id === "../service/mini_redis") return { singletonMemoryRedis: {
    get: key => limits.get(key), set: (key, value) => limits.set(key, value), ttl: () => 1
  } };
  if (id === "mcsmanager-common") return common;
  if (id === "../utils/sync") return { execWithMutexId: unexpected };
  return unexpected(id);
};
const permission = loadTs("panel/src/app/middleware/permission.ts", middlewareImports);
const limit = loadTs("panel/src/app/middleware/limit.ts", middlewareImports);
const validator = loadTs("panel/src/app/middleware/validator.ts", unexpected);
const modTarget = loadTs("panel/src/app/utils/mod_target.ts", unexpected);
const router = loadTs("panel/src/app/routers/mod_manager_router.ts", id => {
  if (id === "@koa/router") return panelRequire(id);
  if (id === "../entity/user") return { ROLE: { USER: 1, ADMIN: 10 } };
  if (id === "../i18n") return translate;
  if (id === "../middleware/permission") return permission;
  if (id === "../middleware/limit") return limit;
  if (id === "../middleware/validator") return validator;
  if (id === "../service/passport_service") return passport;
  if (id === "../utils/mod_target") return modTarget;
  if (id === "../service/permission_service") return { isHaveInstanceByUuid: (userId, daemon, uuid) => {
    calls.push(["authorize", userId, daemon, uuid]);
    return allow && userId === "user" && daemon === "daemon" && uuid === "owned";
  } };
  if (id === "../setting") return { systemConfig: { get canFileManager() { return fileManagerEnabled; } } };
  if (id === "../service/remote_service") return asDefault({ getInstance: daemon => daemon });
  if (id === "../service/remote_command") return asDefault(class {
    constructor(daemon) { this.daemon = daemon; }
    async request(event, data) {
      assert.equal(event, "instance/mods/list");
      calls.push(["rpc", this.daemon, structuredClone(data)]);
      return (await rpc(data)).value;
    }
  });
  if (id === "../service/mod_manager_service") return { modManagerService: new Proxy({}, { get: () => unexpected }) };
  if (id === "../utils/url") return { checkSafeUrl: unexpected };
  return unexpected(id);
}).default;
const Koa = panelRequire("koa");
const Router = panelRequire("@koa/router");
const { koaBody } = panelRequire("koa-body");
const app = new Koa();
app.use(async (ctx, next) => {
  ctx.session = level ? { login: true, uuid: "user", userName: "tester", token: "token" } : {};
  try { await next(); } catch (err) { ctx.status = 500; ctx.body = err.message; }
});
app.use(koaBody({ parsedMethods: ["GET", "POST"] }));
const api = new Router({ prefix: "/api" });
api.use(router.routes(), router.allowedMethods());
app.use(api.routes()).use(api.allowedMethods());
let server;
before(async () => { server = app.listen(0, "127.0.0.1"); await once(server, "listening"); });
after(async () => { await new Promise(resolve => server.close(resolve)); });
async function get(query = {}, { body = {}, keepLimits = false, ajax = true, route = "list" } = {}) {
  calls.length = 0;
  if (!keepLimits) limits.clear();
  const params = new URLSearchParams({ daemonId: "daemon", uuid: "owned", token: "token", ...query });
  const json = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port,
      path: `/api/mod/${route}?${params}`, method: "GET", agent: false,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(json),
        "x-requested-with": ajax ? "XMLHttpRequest" : "" }
    }, res => {
      let text = "";
      res.setEncoding("utf8").on("data", part => { text += part; });
      res.on("end", () => { let value; try { value = JSON.parse(text); } catch { value = text; }
        resolve({ status: res.statusCode, value }); });
    });
    req.on("error", reject); req.end(json);
  });
}

test("Toast from original page five is found on filtered page one with exact filtered totals", async () => {
  const original = await service.listMods("owned", 5);
  assert.equal(original.total, files.size);
  assert.ok(original.mods.some(mod => mod.name === "Toast Notifications"));
  assert.equal((await service.listMods("owned")).mods.some(mod => mod.name === "Toast Notifications"), false);
  const result = await service.listMods("owned", 1, 50, undefined, "  tOaSt  ");
  assert.equal(result.total, 4);
  assert.equal(result.page, 1);
  assert.ok(result.mods.some(mod => mod.file === "bread-alert.jar"));
  assert.ok(result.mods.some(mod => !mod.enabled));
  const fallback = result.mods.find(mod => mod.file === "Unparsed-Toast.jar.disabled");
  assert.equal(fallback.name, fallback.file);
  assert.equal(fallback.version, "Unknown");
  assert.equal(fallback.enabled, false);
  assert.deepEqual(result.folders, ["mods", "plugins"]);
});

test("name OR filename search preserves folder filters and literal semantics", async () => {
  assert.equal((await service.listMods("owned", 1, 50, "PLUGINS", "FILE-MATCH")).total, 1);
  assert.equal((await service.listMods("owned", 1, 50, "mods", "FILE-MATCH")).total, 0);
  assert.equal((await service.listMods("owned", 1, 50, undefined, "[toast]+")).total, 1);
  for (const query of [".*", "../../mods", "https://provider.invalid/"]) {
    const result = await service.listMods("owned", 99, 50, undefined, query);
    assert.equal(result.total, 0); assert.equal(result.page, 1); assert.deepEqual(result.mods, []);
    assert.deepEqual(result.folders, ["mods", "plugins"]);
  }
  assert.ok(scanPaths.every(p => ["mods", "plugins", "Mods", "Plugins"].some(dir => p === path.join(fixtureRoot, dir))));
});

test("omitted/empty/whitespace queries retain unfiltered results, default size and old four-argument calls", async () => {
  const baseline = await service.listMods("owned", 2, 50, "mods");
  assert.equal(baseline.total, 226);
  for (const query of ["", "  \n\t"]) assert.deepEqual(await service.listMods("owned", 2, 50, "mods", query), baseline);
  assert.equal((await service.listMods("owned")).pageSize, 50);
});

test("filtered pages partition every match and clamp past-end/no-result pages consistently", async () => {
  const pages = await Promise.all([1, 2, 3].map(page => service.listMods("owned", page, 100, "mods", "base-")));
  assert.deepEqual(pages.map(p => [p.total, p.page, p.mods.length]), [[220, 1, 100], [220, 2, 100], [220, 3, 20]]);
  assert.equal(new Set(pages.flatMap(p => p.mods.map(mod => mod.file))).size, 220);
  assert.deepEqual(await service.listMods("owned", 999, 100, "mods", "base-"), pages[2]);
  assert.equal((await service.listMods("owned", Infinity, 100, "mods", "base-")).page, 3);
});

test("stable tie ordering survives changed scan/completion order; metadata cache and 10-worker bound remain", async () => {
  const beforeReads = metadataReads;
  await service.listMods("owned", 1, 50, undefined, "Toast");
  assert.equal(metadataReads, beforeReads, "search must reuse cached metadata");
  assert.equal(peak, 10);
  const first = await service.listMods("owned", 1, 50, undefined, "Twin");
  reverse = true;
  const second = await newService().listMods("owned", 1, 50, undefined, "Twin");
  reverse = false;
  assert.deepEqual(first, second);
  assert.deepEqual(first.mods.map(m => [m.folder, m.file]), [["mods", "tie-a.jar"], ["mods", "tie-b.jar"], ["plugins", "tie-p.jar"]]);
});

const sizes = [[100, 100], [250, 250], [251, 250], [99999, 250], [Infinity, 250], [-Infinity, 1],
  [-5, 1], [0, 50], [NaN, 50], ["invalid", 50], [1.9, 1], [undefined, 50]];
test("service and RPC accept 100/250 and clamp malformed/oversized page sizes", async () => {
  for (const [input, expected] of sizes) {
    const direct = await service.listMods("owned", 1, input);
    const remote = (await rpc({ instanceUuid: "owned", page: 1, pageSize: input })).value;
    for (const result of [direct, remote]) {
      assert.equal(result.pageSize, expected, String(input));
      assert.equal(result.mods.length, expected, String(input));
      assert.equal(result.total, files.size);
    }
  }
  for (const page of [-5, NaN, "invalid", 0, 1.9]) assert.equal((await service.listMods("owned", page)).page, 1);
});

test("RPC query reaches service and preserves folder discovery, download and upload metadata", async () => {
  const result = (await rpc({ instanceUuid: "owned", page: 5, pageSize: 250, query: "tOaSt", folder: "mods" })).value;
  assert.equal(result.page, 1); assert.equal(result.total, 4);
  assert.deepEqual(result.folders, ["mods", "plugins"]);
  assert.deepEqual(result.downloadTasks.map(t => t.taskId || t.id), ["inside", "upload"]);
  assert.equal(result.downloadTasks[0].path, "/mods/pending.jar");
  assert.equal(result.downloadTasks[1].current, 5);
  assert.equal(result.downloadFileFromURLTask, 2);
  const denied = await rpc({ instanceUuid: "missing", query: "Toast" });
  assert.ok(denied.error); assert.equal(denied.value, undefined);
});

test("mounted GET transports optional query, folder and normalized paging through RPC into actual service", async () => {
  for (const [input, expected] of sizes) {
    const result = await get({ query: "  tOaSt  ", page: 5, pageSize: input === undefined ? "" : String(input), folder: "mods" });
    assert.equal(result.status, 200);
    assert.equal(result.value.pageSize, expected);
    assert.equal(result.value.total, 4);
    assert.deepEqual(calls[0], ["authorize", "user", "daemon", "owned"]);
    assert.deepEqual(calls[1], ["rpc", "daemon", { instanceUuid: "owned", page: 5, pageSize: expected, folder: "mods", query: "  tOaSt  " }]);
  }
  assert.equal((await get()).value.total, files.size);
  assert.equal(calls[1][2].query, "");
  for (const size of [100, 250]) assert.equal((await get({ pageSize: size })).value.mods.length, size);
});

test("search retains auth/token/AJAX, owned target, conflicting IDs, file-manager policy and limiter gates", async () => {
  const query = { query: "Toast", pageSize: 250 };
  try {
    for (const bad of [{ uuid: "other" }, { daemonId: "other" }, { uuid: "" }, { daemonId: "" }]) {
      assert.ok((await get({ ...query, ...bad })).status >= 400);
      assert.equal(calls.some(call => call[0] === "rpc"), false);
    }
    assert.equal((await get(query, { body: { daemonId: "other", uuid: "other" } })).status, 400);
    assert.equal(calls.length, 0);
    allow = false; assert.equal((await get(query)).status, 403);
    assert.equal(calls.some(call => call[0] === "rpc"), false); allow = true;
    fileManagerEnabled = false; assert.equal((await get(query)).status, 403); assert.equal(calls.length, 0);
    level = 10; assert.equal((await get(query)).status, 200); level = 1; fileManagerEnabled = true;
    level = 0; assert.ok((await get(query)).status >= 400); assert.equal(calls.some(call => call[0] === "rpc"), false); level = 1;
    assert.equal((await get({ ...query, token: "wrong" })).status, 403);
    assert.equal(calls.some(call => call[0] === "rpc"), false);
    assert.equal((await get(query, { ajax: false })).status, 403);
    assert.equal(calls.some(call => call[0] === "rpc"), false);
    assert.equal((await get(query)).status, 200);
    assert.equal((await get(query, { keepLimits: true })).status, 500);
    assert.equal(calls.some(call => call[0] === "rpc"), false);
    mutateTarget = true;
    assert.equal((await get(query)).status, 200);
    assert.equal(calls[1][1], "daemon"); assert.equal(calls[1][2].instanceUuid, "owned");
    assert.equal((await get({ limit: 51 }, { route: "search" })).status, 500, "provider search limit stays 50");
  } finally { level = 1; allow = true; fileManagerEnabled = true; mutateTarget = false; }
});

// Load the actual enrichment service, including requestWithRetry and its cache.
// Stub only HTTP and background timers; let the startup warmer finish against
// empty fixture responses before measuring any batch requests.
async function batchFixture() {
  const requests = [];
  const warmupRequests = [];
  let warming = true;
  let inFlight = 0;
  let peak = 0;
  const axios = async config => {
    if (warming) {
      assert.ok(config.url.endsWith("/search"), config.url);
      warmupRequests.push(config.url);
      return { data: { hits: [], data: [], pagination: { totalCount: 0 } } };
    }
    assert.equal(config.timeout, 5000, "use the existing requestWithRetry path");
    peak = Math.max(peak, ++inFlight);
    try {
      await new Promise(resolve => setImmediate(resolve));
      if (config.method === "POST" && config.url === "https://api.modrinth.com/v2/version_files") {
        const { hashes, algorithm } = config.data;
        assert.equal(algorithm, "sha1");
        assert.ok(hashes.length <= 50);
        requests.push(["versions", [...hashes]]);
        return { data: Object.fromEntries(hashes.map(hash => [hash, {
          id: `version-${hash}`, project_id: `project-${hash}`
        }])) };
      }
      assert.equal(config.method, "GET");
      assert.equal(config.url, "https://api.modrinth.com/v2/projects");
      const ids = JSON.parse(config.params.ids);
      assert.ok(ids.length <= 50);
      requests.push(["projects", ids]);
      return { data: ids.map(id => ({ id, title: `Title ${id}` })) };
    } finally { inFlight--; }
  };
  const { modManagerService: batch } = loadTs("panel/src/app/service/mod_manager_service.ts", id => {
    if (id === "axios") return asDefault(axios);
    return unexpected(id);
  }, { setInterval() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(warmupRequests.length, 2);
  warming = false;
  return { batch, requests, peak: () => peak };
}

for (const count of [100, 250]) {
  test(`actual batch service enriches all ${count} cold hashes in sequential 50-hash slices and reuses cache`, async () => {
    const { batch, requests, peak } = await batchFixture();
    const hashes = Array.from({ length: count }, (_, index) => `hash-${index}`);
    const enriched = await batch.getInfosByHashes(hashes);
    assert.deepEqual(Object.keys(enriched), hashes);
    for (const hash of hashes) {
      assert.deepEqual(enriched[hash], {
        version: { id: `version-${hash}`, project_id: `project-${hash}` },
        project: { id: `project-${hash}`, title: `Title project-${hash}` }
      });
    }
    const expected = [];
    for (let offset = 0; offset < count; offset += 50) {
      const slice = hashes.slice(offset, offset + 50);
      expected.push(["versions", slice], ["projects", slice.map(hash => `project-${hash}`)]);
    }
    assert.deepEqual(requests, expected, "finish version/project lookup before the next chunk");
    assert.equal(peak(), 1, "provider requests remain sequential");
    const cached = await batch.getInfosByHashes(hashes);
    assert.deepEqual(cached, enriched);
    for (const hash of hashes) assert.equal(cached[hash], enriched[hash]);
    assert.deepEqual(requests, expected, "fully cached repeat makes no provider requests");
  });
}

test("actual batch service rejects 251 hashes before any provider request", async () => {
  const { batch, requests } = await batchFixture();
  const hashes = Array.from({ length: 251 }, (_, index) => `hash-${index}`);
  await assert.rejects(batch.getInfosByHashes(hashes), /Hashes length cannot be greater than 250/);
  assert.deepEqual(requests, []);
});
