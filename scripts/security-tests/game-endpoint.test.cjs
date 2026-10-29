const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
require("../../panel/node_modules/ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", esModuleInterop: true, target: "ES2022" } });
const endpoint = require("../../daemon/src/service/game_endpoint.ts");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nexcraft-endpoint-"));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
let nextId = 0;
function instance(type = "minecraft/java", port = 25565) {
  const root = path.join(temp, String(++nextId)); fs.mkdirSync(root);
  return { config: { type, pingConfig: { ip: "127.0.0.1", port } }, absoluteCwdPath: () => root };
}
function properties(inst, text) { fs.writeFileSync(path.join(inst.absoluteCwdPath(), "server.properties"), text); }
test("configured port wins over stale ping and stopped property edits invalidate cache", () => {
  const inst = instance(); properties(inst, "server-port=25570\n");
  assert.deepEqual(endpoint.resolveGameEndpoint(inst), { port: 25570, protocol: "tcp", source: "server.properties" });
  properties(inst, "server-port=25571\n#updated\n");
  assert.equal(endpoint.resolveGameEndpoint(inst).port, 25571);
  assert.equal(inst.config.pingConfig.port, 25565);
});
test("strict properties validation stays unavailable without writes or ping-config guesses", () => {
  for (const value of ["0", "65536", "-1", "12e3", "25565junk", "1.2", ""]) {
    const inst = instance(); properties(inst, "server-port=" + value + "\n");
    assert.deepEqual(endpoint.resolveGameEndpoint(inst), { port: null, protocol: "tcp", source: "unavailable" });
    inst.config.pingConfig.port = 0;
    assert.equal(endpoint.resolveGameEndpoint(inst).port, null);
  }
  const inst = instance(); const before = fs.readdirSync(inst.absoluteCwdPath());
  assert.equal(endpoint.resolveGameEndpoint(inst).source, "unavailable");
  assert.deepEqual(fs.readdirSync(inst.absoluteCwdPath()), before);
  assert.equal(endpoint.resolveGameEndpoint(instance("universal")).port, null);
});
test("Bedrock resolves distinct configured UDP/IPv6 ports", () => {
  const inst = instance("minecraft/bedrock"); properties(inst, "server-port=19140\nserver-portv6=19141\n");
  assert.deepEqual(endpoint.resolveGameEndpoint(inst), { port: 19140, ipv6Port: 19141, protocol: "udp", source: "server.properties" });
});
test("symlink/junction roots and oversized properties never disclose external configured port", () => {
  const inst = instance(); const outside = instance(); properties(outside, "server-port=31000\n");
  const linked = path.join(temp, "linked-root"); fs.symlinkSync(outside.absoluteCwdPath(), linked, process.platform === "win32" ? "junction" : "dir");
  assert.equal(endpoint.resolveGameEndpoint({ ...inst, absoluteCwdPath: () => linked }).port, null);
  if (process.platform !== "win32") {
    fs.symlinkSync(path.join(outside.absoluteCwdPath(), "server.properties"), path.join(inst.absoluteCwdPath(), "server.properties"));
    assert.equal(endpoint.resolveGameEndpoint(inst).port, null);
    fs.unlinkSync(path.join(inst.absoluteCwdPath(), "server.properties"));
  }
  properties(inst, "#".repeat(140000) + "\nserver-port=31000\n");
  assert.equal(endpoint.resolveGameEndpoint(inst).port, null);
});
test("local ping uses configured port while intentional remote override remains intact", () => {
  const inst = instance(); properties(inst, "server-port=25570\n");
  for (const ip of ["", "localhost", "127.0.0.1", "127.0.1.2", "::1", "[::1]", "0.0.0.0"]) {
    inst.config.pingConfig.ip = ip; assert.equal(endpoint.resolveMinecraftPingPort(inst), 25570);
  }
  inst.config.pingConfig.ip = "remote.example"; assert.equal(endpoint.resolveMinecraftPingPort(inst), 25565);
  inst.config.pingConfig.port = 65536; assert.equal(endpoint.resolveMinecraftPingPort(inst), null);
});
// Only isolate unrelated app imports; exercise the actual panel validation and pure frontend logic.
const load = Module._load;
Module._load = function(request, parent, main) {
  if (request === "mcsmanager-common") return { removeTrail: (v) => v };
  if (request === "@/lang/i18n") return { t: (key) => key };
  if (request === "vue") return { computed: (fn) => ({ get value() { return fn(); } }), toValue: (v) => typeof v === "function" ? v() : v?.value ?? v };
  return load.call(this, request, parent, main);
};
const { normalizeGameHost, RemoteServiceConfig } = require("../../panel/src/app/entity/entity_interface.ts");
const frontend = require("../../frontend/src/hooks/useGameEndpoint.ts");
Module._load = load;
test("server and client reject host URLs, ports, credentials, controls, invalid IPs", () => {
  for (const host of ["https://host", "host:24444", "[::1]:25565", "user@host", "host/path", "host?x", "host#x", "host\\x", " host", "host ", "host\n", "999.1.1.1", "-bad.example", "a..b", "[wrong]", "2001:::1", "fe80::1%eth0"]) {
    assert.throws(() => normalizeGameHost(host), undefined, host);
    assert.equal(frontend.normalizeGameHost(host), null, host);
  }
  for (const [input, normalized] of [["", ""], ["PLAY.Example.com", "play.example.com"], ["192.0.2.1", "192.0.2.1"], ["2001:db8::1", "2001:db8::1"], ["[2001:db8::1]", "2001:db8::1"]]) {
    assert.equal(normalizeGameHost(input), normalized); assert.equal(frontend.normalizeGameHost(input), normalized);
  }
  const saved = JSON.parse(JSON.stringify(Object.assign(new RemoteServiceConfig(), { gameHost: "play.example" })));
  assert.equal(saved.gameHost, "play.example");
});
test("address formatting uses IPv6 port, honest unknown and hostname-only RPC fallback", () => {
  const inst = { gameEndpoint: { port: 19132, ipv6Port: 19133, protocol: "udp", source: "server.properties" } };
  assert.equal(frontend.gameAddress(inst, { gameHost: "2001:db8::1", ip: "rpc.example", port: 24444 }).address, "[2001:db8::1]:19133");
  const fallback = frontend.gameAddress(inst, { ip: "wss://node.example", port: 24444 });
  assert.equal(fallback.source, "server.properties");
  assert.equal(fallback.address, "node.example:19132"); assert.equal(fallback.hostSource, "node");
  assert.equal(frontend.gameAddress(inst, { ip: "https://user@host/path" }).address, "");
  assert.equal(frontend.gameAddress({ gameEndpoint: { port: null } }, { gameHost: "play.example" }).address, "");
  assert.equal(frontend.gameAddress(inst, { gameHost: "bad/host", ip: "rpc.example" }).address, "");
});
test("reactive hook updates configured address when instance prop is replaced", () => {
  let inst = { gameEndpoint: { port: 25565, protocol: "tcp", source: "server.properties" } };
  const state = frontend.useGameEndpoint(() => inst, () => ({ gameHost: "play.example" }));
  assert.equal(state.value.address, "play.example:25565");
  inst = { gameEndpoint: { port: 25566, protocol: "tcp", source: "server.properties" } };
  assert.equal(state.value.address, "play.example:25566");
});


test("panel create/update/list persist gameHost, preserve omitted value and reject before side effects", async () => {
  const services = new Map(); const saved = new Map(); let registrations = 0; let settings = 0;
  const subsystem = {
    services,
    getInstance: (id) => services.get(id),
    async registerRemoteService(config) {
      registrations++; const service = { uuid: "node", available: true, config: { ...config }, get gameHost() { return this.config.gameHost || ""; } };
      services.set(service.uuid, service); return service;
    },
    async edit(id, config) {
      const service = services.get(id);
      for (const key of ["ip", "port", "prefix", "apiKey", "remarks", "remoteMappings"]) if (config[key] !== undefined) service.config[key] = config[key];
      saved.set(id, JSON.parse(JSON.stringify(service.config)));
    }
  };
  class Router {
    constructor() { this.handlers = new Map(); }
    get(url, ...handlers) { this.handlers.set("GET " + url, handlers.at(-1)); }
    post(url, ...handlers) { this.handlers.set("POST " + url, handlers.at(-1)); }
    put(url, ...handlers) { this.handlers.set("PUT " + url, handlers.at(-1)); }
    delete(url, ...handlers) { this.handlers.set("DELETE " + url, handlers.at(-1)); }
  }
  const original = Module._load;
  Module._load = function(request, parent, main) {
    if (request === "@koa/router") return Router;
    if (request === "../entity/user") return { ROLE: { ADMIN: 10 } };
    if (request === "../middleware/permission" || request === "../middleware/validator") return () => () => {};
    if (request === "../service/operation_logger") return { operationLogger: { log() {} } };
    if (request === "../service/remote_service") return subsystem;
    if (request === "../service/remote_command") return class { async request() { settings++; return true; } };
    return original.call(this, request, parent, main);
  };
  let router;
  try { router = require("../../panel/src/app/routers/daemon_router.ts").default; } finally { Module._load = original; }
  const ctx = (body) => ({ request: { body, query: { uuid: "node" } }, session: {}, ip: "127.0.0.1" });
  const create = router.handlers.get("POST /remote_service");
  await assert.rejects(create(ctx({ gameHost: "https://bad" }))); assert.equal(registrations, 0);
  await create(ctx({ ip: "rpc.example", port: 24444, apiKey: "secret", remarks: "node", gameHost: "PLAY.Example" }));
  assert.equal(saved.get("node").gameHost, "play.example");
  const update = router.handlers.get("PUT /remote_service");
  await update(ctx({ gameHost: "[2001:db8::1]" })); assert.equal(saved.get("node").gameHost, "2001:db8::1");
  await update(ctx({ remarks: "changed" })); assert.equal(saved.get("node").gameHost, "2001:db8::1");
  const before = settings; await assert.rejects(update(ctx({ gameHost: "bad:25565", setting: {} }))); assert.equal(settings, before);
  const listing = {}; await router.handlers.get("GET /remote_services_list")(listing);
  assert.equal(listing.body[0].gameHost, "2001:db8::1"); assert.equal(listing.body[0].apiKey, undefined);
  await update(ctx({ gameHost: "" })); assert.equal(saved.get("node").gameHost, "");
});

test("daemon select/overview/section/detail return configured endpoint independently of status", async () => {
  const inst = instance(); properties(inst, "server-port=25590\nrcon.password=never-expose\n");
  Object.assign(inst, { instanceUuid: "instance", startCount: 0, autoRestartCount: 0, status: () => 0, info: {}, forceExec: async () => ({}) });
  const routes = new Map(); const subsystem = {
    exists: () => true, getInstance: () => inst, getInstances: () => [inst], isGlobalInstance: () => false,
    getQueryMapWrapper: () => ({ select: (filter) => filter(inst) ? [inst] : [], page: (data) => ({ data, page: 1, pageSize: 10, maxPage: 1 }) })
  };
  inst.config.nickname = "instance";
  const original = Module._load;
  Module._load = function(request, parent, main) {
    if (parent?.filename.endsWith("Instance_router.ts")) {
      if (request === "../service/game_endpoint") return endpoint;
      if (request === "fs-extra") return fs;
      if (request === "path") return path;
      if (request === "mcsmanager-common") return { arrayUnique: (a) => [...new Set(a)], toNumber: Number };
      if (request === "../service/router") return { routerApp: { use() {}, on: (name, callback) => routes.set(name, callback) } };
      if (request === "../service/system_instance") return subsystem;
      if (request === "../service/protocol") return { ROLE: { ADMIN: 10 }, response: (ctx, data) => { ctx.body = data; }, msg: (ctx, event, data) => { ctx.body = data; }, error: (ctx, event, error) => { throw Error(JSON.stringify(error)); } };
      if (request === "../i18n") return { $t: (v) => v };
      return { __esModule: true, default: class {}, TaskCenter: {}, QuickInstallTask: class {} };
    }
    return original.call(this, request, parent, main);
  };
  try { require("../../daemon/src/routers/Instance_router.ts"); } finally { Module._load = original; }
  for (const name of ["instance/select", "instance/overview", "instance/section", "instance/detail"]) {
    const context = {}; await routes.get(name)(context, { instanceUuid: "instance", instanceUuids: ["instance"], condition: {} });
    const detail = name === "instance/detail" ? context.body : name === "instance/select" ? context.body.data[0] : context.body[0];
    assert.equal(detail.gameEndpoint.port, 25590, name); assert.equal(detail.gameEndpoint.source, "server.properties", name);
    assert.equal(JSON.stringify(detail.gameEndpoint).includes("never-expose"), false);
  }
});

test("actual Java ping command consumes configured local port and preserves remote target", async () => {
  const targets = []; const original = Module._load;
  Module._load = function(request, parent, main) {
    if (request === "mcsmanager-common") return { MCServerStatus: class { constructor(port, host) { targets.push({ port, host }); } async getStatus() { return { online: false }; } }, toNumber: Number };
    if (parent?.filename.endsWith("mc_ping.ts") && request === "../base/command") return class {};
    return original.call(this, request, parent, main);
  };
  let Command;
  try { Command = require("../../daemon/src/entity/commands/minecraft/mc_ping.ts").default; } finally { Module._load = original; }
  const inst = instance(); inst.resetPingInfo = () => {}; properties(inst, "server-port=25600\n");
  await new Command().exec(inst); assert.deepEqual(targets.at(-1), { port: 25600, host: "127.0.0.1" });
  inst.config.pingConfig.ip = "proxy.example"; await new Command().exec(inst);
  assert.deepEqual(targets.at(-1), { port: 25565, host: "proxy.example" });
  const missing = instance(); missing.resetPingInfo = () => {};
  await new Command().exec(missing); assert.equal(targets.length, 2);
  missing.config.pingConfig.ip = "proxy.example";
  await new Command().exec(missing); assert.deepEqual(targets.at(-1), { port: 25565, host: "proxy.example" });
});


test("wake listener binds configured port, rebinds after property edit and never invents a missing port", () => {
  const { EventEmitter } = require("node:events"); const listeners = [];
  const net = { createServer() {
    const server = new EventEmitter();
    server.listen = (port, callback) => { server.port = port; callback(); };
    server.address = () => ({ port: server.port });
    server.close = () => { server.closed = true; };
    listeners.push(server); return server;
  } };
  const original = Module._load;
  Module._load = function(request, parent, main) {
    if (parent?.filename.endsWith("wake_listener_service.ts")) {
      if (request === "net") return net;
      if (request === "../entity/instance/instance") return class { static STATUS_STOP = 0; };
      if (request === "./log") return { info() {}, warn() {}, error() {} };
    }
    return original.call(this, request, parent, main);
  };
  let wake;
  try { wake = require("../../daemon/src/service/wake_listener_service.ts").default; } finally { Module._load = original; }
  const inst = instance(); Object.assign(inst, { instanceUuid: "wake", status: () => 0, on() {} });
  inst.config.sleepOnEmpty = { enabled: true, wakeOnJoin: true };
  properties(inst, "server-port=25610\n"); wake.applyForInstance(inst); assert.equal(listeners.at(-1).port, 25610);
  properties(inst, "server-port=25611\n#edited\n"); wake.applyForInstance(inst);
  assert.equal(listeners[0].closed, true); assert.equal(listeners.at(-1).port, 25611);
  properties(inst, "server-port=bad\n"); wake.applyForInstance(inst);
  assert.equal(listeners.at(-1).closed, true); assert.equal(listeners.length, 2);
  wake.closeListener("wake");
  const missing = instance(); Object.assign(missing, { instanceUuid: "missing-wake", status: () => 0, on() {} });
  missing.config.sleepOnEmpty = { enabled: true, wakeOnJoin: true };
  missing.config.pingConfig.ip = "proxy.example";
  wake.applyForInstance(missing); assert.equal(listeners.length, 2);
  wake.closeListener("missing-wake");
});


test("Bedrock IPv6 never substitutes the IPv4 listener port when v6 is unknown", () => {
  const inst = { gameEndpoint: { port: 19132, protocol: "udp", source: "server.properties" } };
  assert.equal(frontend.gameAddress(inst, { gameHost: "2001:db8::1" }).address, "");
});


function pollingContext(execute) {
  const vm = require("node:vm");
  const ts = require("../../panel/node_modules/typescript");
  const source = fs.readFileSync(path.join(__dirname, "../../frontend/src/widgets/InstanceList.vue"), "utf8");
  const block = source.match(/const refreshVisibleInstances = async \(\) => \{([\s\S]*?)\n\};\nonMounted/);
  assert.ok(block, "actual polling function found");
  const context = {
    document: { hidden: false }, refreshInFlight: false, mounted: true, endpointGeneration: 0,
    isLoading: { value: false }, multipleMode: { value: false }, currentRemoteNode: { value: { uuid: "node" } },
    operationForm: { value: { instanceName: "", status: "", type: "", currentPage: 1, pageSize: 20 } },
    selectedTags: { value: [] }, isGlobalDaemonMode: { value: false }, instances: { value: { previous: true } },
    tableTreeData: { value: [] }, remoteInstances: () => ({ execute }), useInstanceMoreDetail: (inst) => inst
  };
  const code = ts.transpileModule("async function refreshVisibleInstances() {" + block[1] + "\n}", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.createContext(context); vm.runInContext(code, context);
  return context;
}
test("actual list polling bounds fanout, sets timeout and remains silent during background refresh", async () => {
  let active = 0, peak = 0; const configs = [];
  const context = pollingContext(async (config) => {
    configs.push(config); active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve)); active--;
    return { value: { data: [{ instanceUuid: config.params.daemonId + config.params.page, config: { nickname: "Server" } }] } };
  });
  context.isGlobalDaemonMode.value = true;
  context.tableTreeData.value = ["a", "b", "c"].map((key) => ({ key, nodeCurrentPage: 3, children: [] }));
  await context.refreshVisibleInstances();
  assert.equal(configs.length, 9); assert.equal(peak, 4); assert.equal(context.refreshInFlight, false);
  for (const config of configs) { assert.equal(config.timeout, 15000); assert.equal(config.errorAlert, false); }
  for (const row of context.tableTreeData.value) assert.equal(row.children.length, 3);
  context.document.hidden = true; await context.refreshVisibleInstances(); assert.equal(configs.length, 9);
});
test("actual list polling cannot overwrite a newer same-query manual load and unlocks after timeout", async () => {
  let finish;
  const context = pollingContext(() => new Promise((resolve) => { finish = resolve; }));
  const request = context.refreshVisibleInstances();
  context.endpointGeneration++; context.instances.value = { manual: true };
  finish({ value: { stale: true } }); await request;
  assert.deepEqual(context.instances.value, { manual: true }); assert.equal(context.refreshInFlight, false);
  context.remoteInstances = () => ({ execute: async () => { throw new Error("timeout"); } });
  await context.refreshVisibleInstances(); assert.equal(context.refreshInFlight, false);
  assert.deepEqual(context.instances.value, { manual: true });
});


test("actual Bedrock ping uses configured local port, tracks edits and preserves remote override", async () => {
  const { EventEmitter } = require("node:events"); const targets = [];
  const original = Module._load;
  Module._load = function(request, parent, main) {
    if (parent?.filename.endsWith("mc_ping_bedrock.ts")) {
      if (request === "dgram") return { createSocket() {
        const socket = new EventEmitter(); socket.close = () => {};
        socket.send = (message, port, host, callback) => {
          targets.push({ port, host }); callback(null);
          queueMicrotask(() => socket.emit("message", Buffer.from("MCPE;MOTD;123;1.21;2;20")));
        };
        return socket;
      } };
      if (request === "../base/command") return class {};
    }
    return original.call(this, request, parent, main);
  };
  let Command;
  try { Command = require("../../daemon/src/entity/commands/minecraft/mc_ping_bedrock.ts").default; } finally { Module._load = original; }
  const inst = instance("minecraft/bedrock", 19132); properties(inst, "server-port=19140\nserver-portv6=19141\n");
  const result = await new Command().exec(inst);
  assert.deepEqual(targets.at(-1), { port: 19140, host: "127.0.0.1" });
  assert.deepEqual(result, { version: "1.21", motd: "MCPE", current_players: "2", max_players: "20" });
  properties(inst, "server-port=19142\nserver-portv6=19143\n#edited\n");
  await new Command().exec(inst); assert.equal(targets.at(-1).port, 19142);
  inst.config.pingConfig.ip = "proxy.example";
  await new Command().exec(inst); assert.deepEqual(targets.at(-1), { port: 19132, host: "proxy.example" });
  inst.config.pingConfig.port = 65536;
  assert.equal(await new Command().exec(inst), null); assert.equal(targets.length, 3);
  inst.config.pingConfig.ip = "127.0.0.1"; inst.config.pingConfig.port = 0; properties(inst, "server-port=invalid\n");
  assert.equal(await new Command().exec(inst), null); assert.equal(targets.length, 3);
});

test("remote monitor cannot invent a configured local endpoint; local missing/unreadable config skips ping", () => {
  const inst = instance("minecraft/java", 25577);
  inst.config.pingConfig.ip = "remote.example";
  for (const config of [undefined, "server-port=invalid\n"]) {
    if (config !== undefined) properties(inst, config);
    assert.deepEqual(endpoint.resolveGameEndpoint(inst), { port: null, protocol: "tcp", source: "unavailable" });
    assert.equal(endpoint.resolveMinecraftPingPort(inst), 25577);
    const view = frontend.gameAddress({ gameEndpoint: endpoint.resolveGameEndpoint(inst) }, { ip: "local-node" });
    assert.equal(view.address, ""); assert.equal(view.unknown, "TXT_CODE_game_endpoint_port_unavailable");
  }
  inst.config.pingConfig.ip = "localhost";
  assert.equal(endpoint.resolveMinecraftPingPort(inst), null);
  properties(inst, "server-port=25578\n");
  const open = fs.openSync;
  fs.openSync = () => { const err = new Error("denied"); err.code = "EACCES"; throw err; };
  try { assert.equal(endpoint.resolveGameEndpoint(inst).port, null); } finally { fs.openSync = open; }
  assert.equal(frontend.gameAddress({ gameEndpoint: { port: 25577, source: "ping-config" } }, { ip: "local-node" }).address, "");
});

test("enriched instance host takes priority, supports IPv6, and unavailable enrichment blocks legacy fallback", () => {
  const inst = { gameEndpoint: { port: 19132, ipv6Port: 19133, protocol: "udp", source: "server.properties", host: "2001:db8::1", hostSource: "gameHost" } };
  const formatted = frontend.gameAddress(inst, { gameHost: "wrong.example" });
  assert.equal(formatted.address, "[2001:db8::1]:19133"); assert.equal(formatted.hostSource, "gameHost");
  inst.gameEndpoint.host = ""; inst.gameEndpoint.hostSource = "unavailable";
  assert.equal(frontend.gameAddress(inst, { gameHost: "wrong.example" }).address, "");
  inst.gameEndpoint.host = "bad/host";
  assert.equal(frontend.gameAddress(inst, { ip: "rpc.example" }).address, "");
});

test("actual global polling reconciles growing, loaded, shrinking and empty pages without clearing selection", async () => {
  let maxPage = 2;
  const context = pollingContext(async ({ params }) => ({ value: {
    page: params.page, maxPage,
    data: maxPage === 0 || params.page > maxPage ? [] : [{ instanceUuid: "instance-" + params.page, config: { nickname: "Server" } }]
  } }));
  context.isGlobalDaemonMode.value = true;
  const selection = [{ instanceUuid: "selected" }]; context.selectedInstance = { value: selection };
  const row = { key: "node", maxPage: 1, nodeCurrentPage: 1, children: [] };
  context.tableTreeData.value = [row];
  await context.refreshVisibleInstances();
  assert.equal(row.maxPage, 2); assert.equal(row.nodeCurrentPage, 1); assert.equal(row.children.at(-1).isLoadMore, true);
  row.nodeCurrentPage = 2; maxPage = 3;
  await context.refreshVisibleInstances();
  assert.equal(row.maxPage, 3); assert.equal(row.nodeCurrentPage, 2); assert.equal(row.children.length, 3);
  assert.equal(row.children[1].key, "instance-2"); assert.equal(row.children.at(-1).isLoadMore, true);
  maxPage = 1;
  await context.refreshVisibleInstances();
  assert.equal(row.maxPage, 1); assert.equal(row.nodeCurrentPage, 1); assert.equal(row.children.length, 1);
  assert.equal(row.children.some((child) => child.isLoadMore), false);
  maxPage = 0;
  await context.refreshVisibleInstances();
  assert.equal(row.maxPage, 1); assert.equal(row.nodeCurrentPage, 1); assert.equal(row.children.length, 0);
  assert.equal(context.selectedInstance.value, selection);
});

test("actual global polling ignores retained hidden edition while single-node polling keeps it", async () => {
  const configs = [];
  const context = pollingContext(async (config) => { configs.push(config); return { value: { data: [], maxPage: 1 } }; });
  context.operationForm.value.type = "minecraft/bedrock";
  await context.refreshVisibleInstances();
  assert.equal(configs.at(-1).params.type, "minecraft/bedrock");
  context.isGlobalDaemonMode.value = true;
  context.tableTreeData.value = [{ key: "node", nodeCurrentPage: 1, children: [] }];
  await context.refreshVisibleInstances();
  assert.equal(configs.at(-1).params.type, undefined);
});

test("role-1 instance detail and assigned overview expose only the owned node's player host", async () => {
  const user = { uuid: "player", userName: "Player", permission: 1, instances: [{ daemonId: "own-node", instanceUuid: "own-instance" }] };
  const users = { getInstance: (uuid) => uuid === user.uuid ? user : undefined };
  const services = new Map([
    ["own-node", { uuid: "own-node", available: true, config: { ip: "wss://rpc.example:24444", port: 24444, gameHost: "PLAY.Example", apiKey: "node-secret", remoteMappings: [{ private: true }] } }],
    ["other-node", { uuid: "other-node", available: true, config: { ip: "other-private.example", gameHost: "other-game.example", apiKey: "other-secret" } }]
  ]);
  const requests = []; const lookups = [];
  const subsystem = { services, getInstance: (id) => { lookups.push(id); return services.get(id); } };
  const instance = { instanceUuid: "own-instance", config: { nickname: "Owned" }, info: {}, gameEndpoint: { port: 25579, protocol: "tcp", source: "server.properties" } };
  class Router {
    constructor() { this.handlers = new Map(); }
    get(url, ...handlers) { this.handlers.set("GET " + url, handlers); }
    post() {} put() {} delete() {} all() {}
  }
  const original = Module._load;
  Module._load = function(request, parent, main) {
    if (request === "@koa/router") return Router;
    if (request === "../service/session_store") return { browserRequestAdmission: () => undefined, liveBrowserUser: () => user };
    if (/^(?:\.\.\/service\/|\.\/)(?:user_service)$/.test(request)) return users;
    if (request === "../service/remote_service" || request === "./remote_service") return subsystem;
    if (request === "../service/remote_command" || request === "./remote_command") return class {
      constructor(service) { this.service = service; }
      async request(name, args) { requests.push({ node: this.service.uuid, name, args }); return name === "instance/section" ? [instance] : instance; }
    };
    if (request === "../service/passport_service") return {
      getUserUuid: (ctx) => ctx.session.uuid, isAjax: () => true, getToken: () => "token",
      getUuidByApiKey: () => undefined, ILLEGAL_ACCESS_KEY: "illegal", logout() {}
    };
    if (request === "../i18n") return { $t: (key) => key };
    if (request === "mcsmanager-common") return { toBoolean: (v) => v === true || v === "true", GlobalVariable: { get: () => 0, set() {} } };
    if (request === "../middleware/validator") return () => async (_ctx, next) => next();
    if (request === "../service/operation_logger") return { operationLogger: { log() {} } };
    if (request === "../service/log") return { logger: {} };
    if (request === "../setting") return { systemConfig: {} };
    return original.call(this, request, parent, main);
  };
  let detail, overview, nodeList, helper;
  try {
    for (const file of ["daemon_router", "instance_admin_router", "general_user_router"]) delete require.cache[require.resolve("../../panel/src/app/routers/" + file + ".ts")];
    detail = require("../../panel/src/app/routers/instance_admin_router.ts").default;
    overview = require("../../panel/src/app/routers/general_user_router.ts").default;
    nodeList = require("../../panel/src/app/routers/daemon_router.ts").default;
    helper = require("../../panel/src/app/service/game_endpoint.ts");
  } finally { Module._load = original; }
  const ctx = (daemonId = "own-node", uuid = "own-instance") => ({
    query: { daemonId, uuid, token: "token", advanced: "true" }, request: { header: {} },
    session: { login: true, uuid: "player", userName: "Player", token: "token" }
  });
  const invoke = async (router, route, context) => {
    const handlers = router.handlers.get(route); let index = 0;
    const next = async () => { const handler = handlers[index++]; if (handler) await handler(context, next); };
    await next(); return context;
  };
  const owned = await invoke(detail, "GET /", ctx());
  assert.equal(owned.body.gameEndpoint.host, "play.example"); assert.equal(owned.body.gameEndpoint.hostSource, "gameHost");
  assert.equal(frontend.gameAddress(owned.body).address, "play.example:25579");
  assert.equal(instance.gameEndpoint.host, undefined, "daemon snapshot is not mutated");
  const before = requests.length; const lookupBefore = lookups.length;
  const forbidden = await invoke(detail, "GET /", ctx("other-node", "other-instance"));
  assert.ok(forbidden.body instanceof Error); assert.equal(requests.length, before); assert.equal(lookups.length, lookupBefore);
  const forbiddenSibling = await invoke(detail, "GET /", ctx("own-node", "other-instance"));
  assert.ok(forbiddenSibling.body instanceof Error); assert.equal(requests.length, before);
  const listing = await invoke(nodeList, "GET /remote_services_list", ctx());
  assert.equal(listing.status, 403);
  const assigned = await invoke(overview, "GET /", ctx("other-node", "other-user"));
  assert.equal(assigned.body.instances.length, 1); assert.equal(assigned.body.instances[0].gameEndpoint.host, "play.example");
  assert.equal(requests.at(-1).node, "own-node"); assert.deepEqual(requests.at(-1).args.instanceUuids, ["own-instance"]);
  for (const value of [owned.body, assigned.body]) {
    const json = JSON.stringify(value);
    for (const secret of ["node-secret", "other-secret", "other-private", "other-game", "remoteMappings", "connectOpts"]) assert.equal(json.includes(secret), false, secret);
  }
  assert.deepEqual(helper.playerGameHost({ ip: "wss://rpc.example:24444" }), { host: "rpc.example", hostSource: "node" });
  assert.deepEqual(helper.playerGameHost({ ip: "wss://[2001:db8::2]:24444" }), { host: "2001:db8::2", hostSource: "node" });
  for (const ip of ["https://user:password@rpc.example", "https://rpc.example/path", "bad/host"]) assert.equal(helper.playerGameHost({ ip }).host, "");
  assert.equal(helper.playerGameHost({ gameHost: "bad/host", ip: "rpc.example" }).host, "");
});
