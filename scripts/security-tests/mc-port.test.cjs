"use strict";
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const nativeFs = require("node:fs");
const nativeNet = require("node:net");
const nativeDgram = require("node:dgram");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
require("../../panel/node_modules/ts-node").register({ project: path.resolve(__dirname, "../../daemon/tsconfig.json"), transpileOnly: true });
const realFs = require("../../daemon/node_modules/fs-extra");
const root = nativeFs.mkdtempSync(path.join(os.tmpdir(), "nexcraft-port-"));
after(() => nativeFs.rmSync(root, { recursive: true, force: true }));
const instances = new Map();
const errors = new Map();
const probes = [];
const sockets = [];
const stored = [];
const denied = new Set();
const deniedWrites = new Set();
const reads = new Map();
const readBytes = new Map();
const descriptors = new Map();
const gates = new Map();
let beforeOpen;
let useRealSockets = false;
let ipv6Disabled;
let afterClear;
let backupCapture;
let extractBedrock;
let beforeTelemetry;
const { setServerProperty } = require("../../daemon/src/service/mc_motd.ts");
let maxWriteLength = Infinity;
let maxReadLength = Infinity;
let beforeRead;
const fs = {
  ...realFs,
  openSync(file, flags, mode) {
    beforeOpen?.(file, flags);
    const write = (flags & nativeFs.constants.O_RDWR) !== 0;
    if (denied.has(file) || write && deniedWrites.has(file)) throw Object.assign(new Error("denied"), { code: "EACCES" });
    const fd = realFs.openSync(file, flags, mode);
    descriptors.set(fd, file);
    return fd;
  },
  readFileSync(file, ...args) {
    assert.notEqual(typeof file, "number", "descriptor reads must use bounded readSync");
    return realFs.readFileSync(file, ...args);
  },
  readSync(fd, bytes, offset, length, position) {
    const name = descriptors.get(fd);
    if (position === 0) reads.set(name, (reads.get(name) ?? 0) + 1);
    assert.equal(position, offset, "properties reads use explicit positions");
    assert.ok(position + length <= 128 * 1024 + 1, "read requests stay within cap plus sentinel");
    beforeRead?.(name);
    const count = nativeFs.readSync(fd, bytes, offset, Math.min(length, maxReadLength), position);
    readBytes.set(name, (readBytes.get(name) ?? 0) + count);
    return count;
  },
  writeSync(fd, bytes, offset, length, position) {
    return nativeFs.writeSync(fd, bytes, offset, Math.min(length, maxWriteLength), position);
  },
  closeSync(fd) { descriptors.delete(fd); return realFs.closeSync(fd); }
};
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fakeSocket(tcp, ipv6) {
  const protocol = tcp ? (ipv6 ? "tcp6" : "tcp4") : (ipv6 ? "udp6" : "udp4");
  const emitter = new EventEmitter();
  emitter.closed = false;
  emitter.close = cb => { emitter.closed = true; queueMicrotask(() => cb?.()); };
  const bind = port => {
    const key = `${protocol}:${port}`;
    probes.push(key);
    queueMicrotask(async () => {
      const gate = gates.get(key);
      if (gate) { gate.entered.resolve(); await gate.resume.promise; }
      const code = errors.get(key) || (ipv6 ? ipv6Disabled : undefined);
      if (code) emitter.emit("error", Object.assign(new Error(code), { code }));
      else emitter.emit("listening");
    });
  };
  emitter.bind = port => bind(port);
  emitter.listen = options => bind(options.port);
  sockets.push(emitter);
  return emitter;
}
const net = { createServer: () => {
  // Family is only known at listen time.
  const proxy = new EventEmitter();
  proxy.listen = options => {
    const ipv6 = options.host === "::";
    const socket = useRealSockets && !(ipv6 && ipv6Disabled) ? nativeNet.createServer() : fakeSocket(true, ipv6);
    proxy.close = (...args) => socket.close(...args);
    socket.once("error", error => proxy.emit("error", error));
    socket.once("listening", () => proxy.emit("listening"));
    socket.listen(options);
  };
  return proxy;
} };
const dgram = { createSocket: options => {
  const ipv6 = options.type === "udp6";
  return useRealSockets && !(ipv6 && ipv6Disabled) ? nativeDgram.createSocket(options) : fakeSocket(false, ipv6);
} };
const originalLoad = Module._load;
Module._load = function(id, parent, ...args) {
  if (parent?.filename.endsWith(path.join("service", "mc_port.ts"))) {
    if (id === "fs-extra") return fs;
    if (id === "net") return net;
    if (id === "dgram") return dgram;
    if (id === "../common/system_storage") return { default: { store: (...args) => stored.push(args) }, __esModule: true };
    if (id === "./system_instance") return { default: { instances }, __esModule: true };
  }
  return originalLoad.call(this, id, parent, ...args);
};
let ports;
try { ports = require("../../daemon/src/service/mc_port.ts"); }
finally { Module._load = originalLoad; }
function instance(id, bedrock = false, props) {
  let state = 0;
  const cwd = path.join(root, id);
  nativeFs.mkdirSync(cwd, { recursive: true });
  const value = {
    instanceUuid: id,
    config: { type: bedrock ? "minecraft/bedrock" : "minecraft/java", pingConfig: {} },
    absoluteCwdPath: () => cwd,
    status(next) { if (next !== undefined) state = next; return state; },
    print() {}, println() {}, parameters(values) { Object.assign(this.config, values); },
    async execPreset() { this.status(0); }
  };
  instances.set(id, value);
  if (props !== undefined) nativeFs.writeFileSync(propFile(value), props);
  return value;
}
const propFile = value => path.join(value.absoluteCwdPath(), "server.properties");
const text = value => nativeFs.readFileSync(propFile(value), "utf8");
const write = (value, txt) => nativeFs.writeFileSync(propFile(value), txt);
const descriptor = (source = "serverjar", values = {}) => ({ source, packInfo: {}, mcVersion: "1.21", ...values });
beforeEach(() => {
  for (const value of instances.values()) ports.releaseMcNetwork(value);
  for (const name of nativeFs.readdirSync(root)) nativeFs.rmSync(path.join(root, name), { recursive: true, force: true });
  instances.clear(); errors.clear(); probes.length = 0; sockets.length = 0; stored.length = 0;
  denied.clear(); deniedWrites.clear(); reads.clear(); gates.clear();
  beforeOpen = undefined; useRealSockets = false; ipv6Disabled = undefined; afterClear = undefined;
  maxWriteLength = Infinity; maxReadLength = Infinity; beforeRead = undefined; readBytes.clear();
  backupCapture = undefined; extractBedrock = undefined; beforeTelemetry = undefined;
});

test("strict JSON port validation accepts only integral numbers and blank Auto", () => {
  for (const raw of [0, -1, 1.5, NaN, Infinity, null, "25565", "1e3", "12x", " ", {}, true, 65536])
    assert.throws(() => ports.validateGamePort(raw), /integer/);
  assert.equal(ports.validateGamePort(undefined), undefined);
  assert.equal(ports.validateGamePort(""), undefined);
  for (const value of [1, 65535]) assert.equal(ports.validateGamePort(value), value);
  assert.throws(() => ports.validateGamePort(65535, true));
  assert.equal(ports.validateGamePort(65534, true), 65534);
});
test("configured stopped endpoints conflict and each neighboring properties file is read once", async () => {
  const stopped = instance("stopped", false, "server-port=26000\nquery.port=26001\nrcon.port=26002\nserver-portv6=26003\n");
  assert.deepEqual([...ports.getUsedMcPorts()], [26000, 26001, 26002, 26003]);
  assert.equal(reads.get(propFile(stopped)), 1);
  await assert.rejects(ports.assignFreeMcPort(instance("new"), 26000), /already in use/);
});
test("orphaned and unreadable OTHER instances reserve conservative persisted config without blocking all installs", async () => {
  const orphan = instance("orphan", true);
  orphan.config.pingConfig.port = 20000;
  orphan.config.rconPort = 20002;
  nativeFs.rmdirSync(orphan.absoluteCwdPath());
  const unreadable = instance("unreadable", false, "server-port=27000\n");
  unreadable.config.pingConfig.port = 27000;
  unreadable.config.rconPort = 27001;
  denied.add(propFile(unreadable));
  for (const port of [20000, 20001, 20002, 27000, 27001]) assert.ok(ports.getUsedMcPorts().has(port));
  await assert.rejects(ports.assignFreeMcPort(instance("conflict"), 27001), /already in use/);
  assert.equal(await ports.assignFreeMcPort(instance("free"), 28000), 28000);
  assert.throws(() => ports.snapshotMcNetwork(unreadable), /denied/);
  await assert.rejects(ports.assignFreeMcPort(unreadable, 29000), /denied/);
});
test("real properties symlink/junction rejects owned snapshot and persistence; outside sentinel stays unchanged", async () => {
  let value = instance("linked");
  const outside = path.join(root, "outside");
  nativeFs.mkdirSync(outside);
  const sentinel = path.join(outside, "server.properties");
  const original = "server-port=26000\nrcon.password=outside-secret\n";
  nativeFs.writeFileSync(sentinel, original);
  try { nativeFs.symlinkSync(sentinel, propFile(value), "file"); }
  catch (error) {
    if (process.platform !== "win32" || error.code !== "EPERM") throw error;
    // Windows without file-link privilege still supports real directory junctions.
    // Exercise a linked owned root pointing at the same outside sentinel.
    nativeFs.rmdirSync(value.absoluteCwdPath());
    nativeFs.symlinkSync(outside, value.absoluteCwdPath(), "junction");
  }
  assert.throws(() => ports.snapshotMcNetwork(value), /links|junctions/i);
  await assert.rejects(ports.assignFreeMcPort(value, 28000), /links|junctions/i);
  assert.equal(nativeFs.readFileSync(sentinel, "utf8"), original);
});
test("Linux no-follow open rejects a leaf swapped after assertSafePath", { skip: process.platform === "win32" }, async () => {
  const value = instance("race", false, "server-port=26000\n");
  const sentinel = path.join(root, "sentinel");
  nativeFs.writeFileSync(sentinel, "outside");
  beforeOpen = file => {
    if (file !== propFile(value)) return;
    beforeOpen = undefined;
    nativeFs.unlinkSync(file);
    nativeFs.symlinkSync(sentinel, file);
  };
  assert.throws(() => ports.snapshotMcNetwork(value), /ELOOP/);
  assert.equal(nativeFs.readFileSync(sentinel, "utf8"), "outside");
});
test("Java probes TCP both families, UDP query, and distinct RCON; creates real properties and ping config", async () => {
  const value = instance("java");
  errors.set("udp4:26000", "EADDRINUSE");
  await assert.rejects(ports.assignFreeMcPort(value, 26000), /already in use/);
  errors.clear(); errors.set("tcp4:26000", "EADDRINUSE");
  await assert.rejects(ports.assignFreeMcPort(value, 26000), /already in use/);
  errors.clear(); errors.set("tcp6:25575", "EADDRINUSE");
  assert.equal(await ports.assignFreeMcPort(value, 26000), 26000);
  assert.equal(value.config.rconPort, 25576);
  assert.match(text(value), /query.port=26000/);
  assert.equal(value.config.pingConfig.port, 26000);
  assert.ok(probes.includes("tcp4:26000") && probes.includes("tcp6:26000"));
  assert.ok(sockets.every(socket => socket.closed), "all successful and failed sockets close");
});
test("Bedrock checks both UDP pair members and persists nondefault pair", async () => {
  const value = instance("bedrock", true);
  errors.set("udp6:20001", "EADDRINUSE");
  await assert.rejects(ports.assignFreeBedrockPort(value, 20000), /already in use/);
  errors.clear(); errors.set("udp4:20000", "EADDRINUSE");
  await assert.rejects(ports.assignFreeBedrockPort(value, 20000), /already in use/);
  errors.clear(); await ports.assignFreeBedrockPort(value, 20000);
  assert.match(text(value), /server-portv6=20001/);
});
for (const code of ["EAFNOSUPPORT", "EADDRNOTAVAIL"]) test(`IPv6 ${code} falls back to IPv4 for Java and Bedrock paired port`, async () => {
  ipv6Disabled = code;
  errors.set("tcp4:26000", "EADDRINUSE");
  await assert.rejects(ports.assignFreeMcPort(instance("java"), 26000), /already in use/);
  errors.clear(); errors.set("udp4:20001", "EADDRINUSE");
  await assert.rejects(ports.assignFreeBedrockPort(instance("bedrock", true), 20000), /already in use/);
  errors.clear(); await ports.assignFreeMcPort(instances.get("java"), 26000);
  await ports.assignFreeBedrockPort(instances.get("bedrock"), 20000);
  assert.ok(probes.includes("udp4:20001"));
  assert.ok(sockets.every(socket => socket.closed));
});
test("unexpected probe errors propagate and close sockets instead of being treated as available", async () => {
  errors.set("tcp6:26000", "EACCES");
  await assert.rejects(ports.assignFreeMcPort(instance("java"), 26000), { code: "EACCES" });
  errors.clear(); errors.set("udp6:20001", "EINVAL");
  await assert.rejects(ports.assignFreeBedrockPort(instance("bedrock", true), 20000), { code: "EINVAL" });
  assert.ok(sockets.every(socket => socket.closed));
});
test("real IPv4 TCP listener is detected with IPv6 disabled", async () => {
  useRealSockets = true; ipv6Disabled = "EAFNOSUPPORT";
  const listener = nativeNet.createServer();
  await new Promise(resolve => listener.listen({ port: 0, host: "0.0.0.0" }, resolve));
  try { await assert.rejects(ports.assignFreeMcPort(instance("live"), listener.address().port), /already in use/); }
  finally { await new Promise(resolve => listener.close(resolve)); }
});
test("real IPv4 UDP listener on Bedrock second paired port is detected during fallback", async () => {
  useRealSockets = true; ipv6Disabled = "EADDRNOTAVAIL";
  const listener = nativeDgram.createSocket("udp4");
  await new Promise(resolve => listener.bind(0, "0.0.0.0", resolve));
  try { await assert.rejects(ports.assignFreeBedrockPort(instance("live", true), listener.address().port - 1), /already in use/); }
  finally { await new Promise(resolve => listener.close(resolve)); }
});
test("bounded Java and Bedrock automatic exhaustion throws without persisting an occupied default", async () => {
  for (let p = 25565; p < 27565; p++) errors.set(`tcp6:${p}`, "EADDRINUSE");
  await assert.rejects(ports.assignFreeMcPort(instance("java")), /No available/);
  assert.equal(stored.length, 0);
  for (let p = 19132; p < 21132; p += 2) errors.set(`udp6:${p + 1}`, "EADDRINUSE");
  await assert.rejects(ports.assignFreeBedrockPort(instance("bedrock", true)), /No available/);
  assert.equal(stored.length, 0);
});
test("delayed competing installs hold Mutex across probes and write; loser cannot claim same explicit port", async () => {
  const a = instance("a"), b = instance("b");
  const gate = { entered: deferred(), resume: deferred() };
  gates.set("tcp6:27000", gate);
  const first = ports.assignFreeMcPort(a, 27000);
  await gate.entered.promise;
  const second = ports.assignFreeMcPort(b, 27000);
  const rejected = assert.rejects(second, /already in use/);
  await new Promise(setImmediate);
  assert.deepEqual(probes, ["tcp6:27000"]);
  assert.equal(nativeFs.existsSync(propFile(b)), false);
  gate.resume.resolve();
  await first; await rejected;
  assert.equal(a.config.pingConfig.port, 27000);
});
test("concurrent automatic installs choose distinct game and RCON ports using real persisted properties", async () => {
  const a = instance("a"), b = instance("b");
  const [pa, pb] = await Promise.all([ports.assignFreeMcPort(a), ports.assignFreeMcPort(b)]);
  assert.notEqual(pa, pb); assert.notEqual(a.config.rconPort, b.config.rconPort);
  assert.match(text(a), new RegExp(`server-port=${pa}`));
  assert.match(text(b), new RegExp(`server-port=${pb}`));
});
test("owned persistence failure releases Mutex and creates no leaked pending reservation", async () => {
  const value = instance("failure");
  deniedWrites.add(propFile(value));
  await assert.rejects(ports.assignFreeMcPort(value, 28000, undefined, true), /denied/);
  instances.delete(value.instanceUuid);
  assert.equal(await ports.assignFreeMcPort(instance("next"), 28000), 28000);
});
test("reset snapshot preserves custom query port and disabled RCON port/password/enablement across file replacement", async () => {
  const value = instance("reset", false, "server-port=26001\nquery.port=26002\nenable-query=true\nrcon.port=26003\nenable-rcon=false\nrcon.password=secret$&value\n");
  const snapshot = ports.snapshotMcNetwork(value);
  errors.set("tcp6:26001", "EADDRINUSE");
  await ports.reservePreservedMcNetwork(value, snapshot, false, true);
  assert.equal(probes.length, 0, "running own endpoints skip OS only before stop");
  nativeFs.unlinkSync(propFile(value)); errors.clear();
  await assert.rejects(ports.assignFreeMcPort(instance("other"), 26002), /already in use/);
  await ports.assignFreeMcPort(value, undefined, snapshot);
  assert.equal(value.config.rconPassword, "secret$&value");
  assert.equal(value.config.rconPort, 26003); assert.equal(value.config.enableRcon, false);
  assert.match(text(value), /query.port=26002/); assert.match(text(value), /rcon.password=secret\$&value/);
  assert.equal(text(value).includes("\0"), false, "fd rewrites start at offset zero");
});
test("preserved Bedrock nonadjacent pair excludes self but rejects stopped neighbor and OS conflicts", async () => {
  const value = instance("reset", true, "server-port=20000\nserver-portv6=20007\n");
  const snapshot = ports.snapshotMcNetwork(value);
  instance("neighbor", false, "server-port=20007\n");
  await assert.rejects(ports.reservePreservedMcNetwork(value, snapshot, true, true), /already in use/);
  instances.delete("neighbor"); errors.set("udp6:20007", "EADDRINUSE");
  await assert.rejects(ports.assignFreeBedrockPort(value, undefined, snapshot), /already in use/);
  errors.clear(); await ports.assignFreeBedrockPort(value, undefined, snapshot);
  assert.match(text(value), /server-portv6=20007/);
});

let created = 0;
class FakeInstance { static STATUS_STOP = 0; static STATUS_BUSY = 2; }
let useActualWake = false;
Module._load = function(id, parent, ...args) {
  if (parent?.filename.endsWith(path.join("service", "wake_listener_service.ts"))) {
    if (id === "../entity/instance/instance") return { default: FakeInstance, __esModule: true };
    if (id === "./log") return { default: { info() {}, warn() {}, error() {} }, __esModule: true };
  }
  return originalLoad.call(this, id, parent, ...args);
};
let wakeService;
try { wakeService = require("../../daemon/src/service/wake_listener_service.ts").default; }
finally { Module._load = originalLoad; }
const taskMocks = {
  axios: {}, "fs-extra": fs, uuid: { v4: () => "task" },
  "../../common/network": { getCommonHeaders: () => ({}) },
  "../../entity/instance/instance": { default: FakeInstance, __esModule: true },
  "../../entity/instance/Instance_config": { default: class {}, __esModule: true },
  "../../i18n": { $t: key => key },
  "../download_manager": {}, "../java_manager": {}, "../mc_port": ports,
  "../wake_listener_service": { default: {
    suspendForInstance: value => useActualWake
      ? wakeService.suspendForInstance(value)
      : Promise.resolve(() => {})
  }, __esModule: true },
  "../modloader_bootstrap": {},
  "../backup_service": { startBackupTask: id => ({ wait: async () => backupCapture?.(instances.get(id)) }) },
  "../mc_motd": { setServerProperty: (...args) => { beforeTelemetry?.(...args); return setServerProperty(...args); } },
  "../../utils/sleep": { sleep: async () => {} },
  "../system_instance": { default: { createInstance: config => {
    created++; const value = instance(`created-${created}`, config.type === "minecraft/bedrock"); return value;
  } }, __esModule: true },
  "../modpack_files": {
    clearForReset: async cwd => { await realFs.emptyDir(cwd); await afterClear?.(cwd); },
    extractZipOverwrite: async (...args) => extractBedrock?.(...args),
    removeKnownClientMods: async () => []
  }
};
Module._load = function(id, parent, ...args) {
  if (parent?.filename.endsWith(path.join("async_task_service", "modpack_install_task.ts")) && Object.hasOwn(taskMocks, id)) return taskMocks[id];
  if (parent?.filename.endsWith(path.join("async_task_service", "index.ts")) && id === "../log") return { error() {} };
  return originalLoad.call(this, id, parent, ...args);
};
let ModpackInstallTask;
try { ({ ModpackInstallTask } = require("../../daemon/src/service/async_task_service/modpack_install_task.ts")); }
finally { Module._load = originalLoad; }
function taskFor(value, source = "serverjar", mode = "wipe", values = {}) {
  const task = new ModpackInstallTask("test", descriptor(source, values), value, mode);
  task.on("error", () => {});
  return task;
}
async function expectReleased(value, port) {
  // Remove all configured evidence, so only an incorrectly leaked reservation could block this port.
  instances.delete(value.instanceUuid);
  assert.equal(await ports.assignFreeMcPort(instance("after-release"), port), port);
}
test("actual install constructor rejects every provider's malformed port before instance creation", () => {
  created = 0;
  for (const source of ["curseforge", "modrinth", "ftb", "vanilla", "serverjar", "bedrock"])
    for (const gamePort of [0, 1.5, NaN, "26000", "bad", null])
      assert.throws(() => new ModpackInstallTask("test", descriptor(source, { gamePort })), /integer/);
  assert.throws(() => new ModpackInstallTask("test", descriptor("bedrock", { gamePort: 65535 })), /integer/);
  assert.equal(created, 0);
});
test("actual task wipe lifecycle restores custom query and RCON settings before provider/bootstrap and on success", async () => {
  const value = instance("reset-task", false, "server-port=28000\nquery.port=28001\nenable-query=true\nrcon.port=28002\nenable-rcon=true\nrcon.password=keep-secret\n");
  const task = taskFor(value);
  task.installServerJar = async () => {
    assert.match(text(value), /rcon.password=keep-secret/);
    assert.match(text(value), /query.port=28001/);
    return "java -jar server.jar";
  };
  await task.start();
  assert.equal(task.errorInfo, undefined); assert.equal(task.phase, "done");
  assert.equal(value.config.rconPort, 28002); assert.equal(value.config.enableRcon, true);
  assert.equal(value.config.rconPassword, "keep-secret");
  assert.equal(value.asynchronousTask, undefined);
  await expectReleased(value, 28001);
});
test("pending reset while properties are wiped retains game/query/RCON reservations against interleaved installs", async () => {
  const value = instance("reset-pending", false, "server-port=28000\nquery.port=28001\nenable-query=true\nrcon.port=28002\nenable-rcon=true\nrcon.password=keep\n");
  const gate = { entered: deferred(), resume: deferred() };
  afterClear = async () => {
    value.config.pingConfig.port = 0; value.config.rconPort = 0;
    gate.entered.resolve(); await gate.resume.promise;
  };
  const task = taskFor(value);
  task.installServerJar = async () => "java -jar server.jar";
  const completion = task.start();
  await gate.entered.promise;
  assert.equal(nativeFs.existsSync(propFile(value)), false);
  for (const port of [28000, 28001, 28002]) await assert.rejects(ports.assignFreeMcPort(instance(`competitor-${port}`), port), /already in use/);
  gate.resume.resolve(); await completion;
  assert.equal(task.errorInfo, undefined);
  assert.match(text(value), /query.port=28001/);
});
test("actual provider failure after overwriting reset properties restores old endpoints and safely releases reservation", async () => {
  const value = instance("reset-failed", false, "server-port=28000\nquery.port=28001\nenable-query=true\nrcon.port=28002\nenable-rcon=false\nrcon.password=old-secret\n");
  const task = taskFor(value, "curseforge");
  task.installCurseForge = async () => { write(value, "server-port=25565\nrcon.password=provider\n"); throw Error("provider failed"); };
  await task.start();
  assert.match(task.errorInfo.message, /provider failed/);
  assert.match(text(value), /server-port=28000/); assert.match(text(value), /query.port=28001/);
  assert.match(text(value), /rcon.password=old-secret/); assert.equal(value.config.enableRcon, false);
  await expectReleased(value, 28001);
});
test("actual cancellation during provider work restores snapshot and releases only after work unwinds", async () => {
  const value = instance("reset-cancel", false, "server-port=28000\nquery.port=28001\nrcon.port=28002\nenable-rcon=false\nrcon.password=old-secret\n");
  const gate = { entered: deferred(), resume: deferred() };
  const task = taskFor(value, "ftb");
  task.installFTB = async () => {
    write(value, "server-port=25565\n"); gate.entered.resolve(); await gate.resume.promise;
    return { mc: "1.21", loader: "vanilla", loaderVersion: "" };
  };
  const completion = task.start(); await gate.entered.promise;
  await task.stop();
  assert.equal(value.asynchronousTask, task);
  await assert.rejects(ports.assignFreeMcPort(instance("during-cancel"), 28001), /already in use/);
  gate.resume.resolve(); await completion;
  assert.match(task.errorInfo.message, /cancelled/);
  assert.notEqual(task.phase, "done"); assert.match(text(value), /rcon.password=old-secret/);
  await expectReleased(value, 28001);
});
test("recovery filesystem failure retains old reservation instead of losing wiped custom endpoints", async () => {
  const value = instance("reset-recovery", false, "server-port=28000\nquery.port=28001\nrcon.port=28002\nenable-rcon=false\n");
  const task = taskFor(value, "curseforge");
  task.installCurseForge = async () => {
    nativeFs.unlinkSync(propFile(value)); deniedWrites.add(propFile(value));
    throw Error("provider failed");
  };
  await task.start();
  assert.match(task.errorInfo.message, /denied/);
  instances.delete(value.instanceUuid);
  await assert.rejects(ports.assignFreeMcPort(instance("competitor"), 28001), /already in use/);
  // Explicit administrator repair/release is deliberately needed in this exceptional case.
  ports.releaseMcNetwork(value);
});
test("running owned endpoints skip OS before stop, then stopped reset endpoints are probed", async () => {
  const value = instance("running", false, "server-port=28000\nquery.port=28001\nrcon.port=28002\nenable-rcon=false\n");
  value.status(3);
  errors.set("tcp6:28000", "EADDRINUSE");
  let kills = 0;
  value.execPreset = async () => { kills++; errors.clear(); value.status(0); };
  const task = taskFor(value); task.installServerJar = async () => "java -jar server.jar";
  await task.start();
  assert.equal(task.errorInfo, undefined); assert.equal(kills, 1);
  assert.ok(probes.includes("tcp6:28000"));
});
test("running owned instance with configured neighbor conflict fails before kill and retains its running status", async () => {
  const value = instance("running", false, "server-port=28000\n"); value.status(3);
  instance("neighbor", false, "server-port=28000\n");
  value.execPreset = async () => { assert.fail("must not stop a server with conflicting configured endpoints"); };
  const task = taskFor(value); await task.start();
  assert.match(task.errorInfo.message, /already in use/);
  assert.equal(value.status(), 3); assert.match(text(value), /server-port=28000/);
});
test("stopped reset checks real OS endpoint conflict and does not wipe properties", async () => {
  const value = instance("stopped", false, "server-port=28000\n");
  errors.set("tcp4:28000", "EADDRINUSE");
  const task = taskFor(value); await task.start();
  assert.match(task.errorInfo.message, /already in use/);
  assert.match(text(value), /server-port=28000/); assert.equal(value.asynchronousTask, undefined);
});
test("reset with missing or unreadable owned properties fails closed instead of automatic reassignment", async () => {
  for (const unreadable of [false, true]) {
    const value = instance(`owned-${unreadable}`, false, unreadable ? "server-port=28000\n" : undefined);
    if (unreadable) denied.add(propFile(value));
    const task = taskFor(value); await task.start();
    assert.match(task.errorInfo.message, /unavailable|denied/);
    assert.equal(probes.length, 0);
  }
});
test("failed competing task cannot release active task reservation or mutate instance status", async () => {
  const value = instance("busy", false, "server-port=30000\n");
  await ports.reservePreservedMcNetwork(value, ports.snapshotMcNetwork(value), false);
  nativeFs.unlinkSync(propFile(value));
  const active = {}; value.asynchronousTask = active; value.status(3);
  const task = taskFor(value); await task.start();
  assert.ok(task.errorInfo); assert.equal(value.asynchronousTask, active); assert.equal(value.status(), 3);
  await assert.rejects(ports.assignFreeMcPort(instance("competitor"), 30000), /already in use/);
});

const panelRoutes = new Map();
const rpcCalls = [];
const panelMocks = {
  "@koa/router": class { get() {} post(route, ...handlers) { panelRoutes.set(route, handlers.at(-1)); } },
  axios: { get: async () => ({ data: { result: { links: [{ downloadType: "serverBedrockLinux", downloadUrl: "https://example.test/bedrock-server-1.21.0.zip" }] } } }) },
  "../entity/user": { ROLE: { ADMIN: 10, USER: 1 } }, "../i18n": { $t: key => key },
  "../middleware/limit": { requestConcurrencyLimiter: () => () => {} },
  "../middleware/permission": () => () => {}, "../middleware/validator": () => () => {},
  "../service/mod_manager_service": { modManagerService: {
    resolveCurseForgeServerPack: async () => ({ serverPackUrl: "https://example.test/pack.zip" }),
    resolveModrinthVersion: async () => ({ mrpackUrl: "https://example.test/pack.mrpack" })
  } },
  "../service/operation_logger": { operationLogger: { log() {} } },
  "../service/remote_command": class { async request(event, data) { rpcCalls.push([event, data]); return data; } },
  "../service/remote_service": { default: { getInstance: () => ({}) }, __esModule: true }
};
Module._load = function(id, parent, ...args) {
  if (parent?.filename === path.resolve(__dirname, "../../panel/src/app/routers/modpack_router.ts") && Object.hasOwn(panelMocks, id)) return panelMocks[id];
  return originalLoad.call(this, id, parent, ...args);
};
try { require("../../panel/src/app/routers/modpack_router.ts"); }
finally { Module._load = originalLoad; }
async function panelInstall(route, body) {
  const ctx = { query: { daemonId: "node" }, request: { body }, session: {} };
  await panelRoutes.get(route)(ctx); return ctx.body;
}
test("actual panel creation routes reject invalid JSON port before RPC and forward all modpack providers and Bedrock", async () => {
  rpcCalls.length = 0;
  for (const route of ["/install", "/install_server"])
    for (const gamePort of [0, 1.5, NaN, "12345", "1e3", "12x", null])
      assert.ok(await panelInstall(route, { gamePort, loader: "vanilla", source: "ftb" }) instanceof Error);
  assert.equal(rpcCalls.length, 0);
  assert.ok(await panelInstall("/install_server", { loader: "bedrock", gamePort: 65535 }) instanceof Error);
  for (const source of ["ftb", "curseforge", "modrinth"]) {
    const result = await panelInstall("/install", { source, projectId: "1", fileId: "2", instanceName: source, gamePort: 27000 });
    assert.equal(result.descriptor.gamePort, 27000); assert.equal(result.descriptor.source, source);
  }
  const bedrock = await panelInstall("/install_server", { loader: "bedrock", mcVersion: "1.21.0", instanceName: "BDS", gamePort: 20000 });
  assert.equal(bedrock.descriptor.gamePort, 20000);
  const auto = await panelInstall("/install", { source: "ftb", gamePort: "" });
  assert.equal(auto.descriptor.gamePort, undefined);
});
test("actual creation validation and number parser reject exponent/fraction/malformed input with blank Auto and dynamic hint", () => {
  const sourceFile = nativeFs.readFileSync(path.resolve(__dirname, "../../frontend/src/widgets/market/ModpackBrowser.vue"), "utf8");
  const expression = sourceFile.match(/const creationPortError = computed\(\(\) => \{([\s\S]*?)\n\}\);/);
  assert.ok(expression);
  const check = new Function("dialog", "isReinstall", "source", "customLoader", "t", expression[1]);
  const error = (port, bedrock = false, reset = false) => check({ gamePort: port }, { value: reset }, { value: "custom" }, { value: bedrock ? "bedrock" : "vanilla" }, (key, params) => {
    assert.equal(key, "TXT_CODE_modpack_game_port_validation");
    assert.equal(params.max, bedrock ? 65534 : 65535);
    return key;
  });
  const parserSource = sourceFile.match(/const parseCreationPort = (.*);/)[1].replace(/\(value\?: string\)/, "(value)").replace(/value!/, "value");
  const parse = new Function(`return ${parserSource}`)();
  for (const raw of ["0", "1.1", "1e3", "1E3", "12x", "0x10", "-1", "+1", " 123", "123 ", " ", "65536"]) {
    assert.notEqual(error(raw), "", raw);
    if (!/^\d+$/.test(raw)) assert.ok(Number.isNaN(parse(raw)), raw);
  }
  assert.equal(parse(""), ""); assert.equal(error(""), "");
  assert.equal(error("65535"), ""); assert.notEqual(error("65535", true), ""); assert.equal(error("65534", true), "");
  assert.equal(error("invalid", false, true), "");
  assert.match(sourceFile, /<a-input-number[\s\S]*?:parser="parseCreationPort"[\s\S]*?@input="setCreationPort"/);
  const hintExpression = sourceFile.match(/const creationPortHint = computed\(\(\) => ([\s\S]*?)\n\);/);
  assert.ok(hintExpression);
  const hint = new Function("creationPortMax", "t", `return ${hintExpression[1]}`);
  const language = JSON.parse(nativeFs.readFileSync(path.resolve(__dirname, "../../languages/en_US.json"), "utf8"));
  const translate = key => { assert.equal(typeof language[key], "string"); return language[key]; };
  assert.match(hint({ value: 65534 }, translate), /1–65534[\s\S]*adjacent IPv6 UDP port \(port \+ 1\)/);
  assert.match(hint({ value: 65535 }, translate), /1–65535/);
  assert.match(language.TXT_CODE_modpack_game_port_validation, /\{max\}/);
});

test("IPv6-only Java query listeners conflict even when IPv4 UDP is free", async () => {
  errors.set("udp6:26000", "EADDRINUSE");
  await assert.rejects(ports.assignFreeMcPort(instance("query-v6"), 26000), /already in use/);
});
test("omitted Java query/RCON properties preserve actual Minecraft defaults despite stale config", async () => {
  const value = instance("defaults", false, "server-port=28000\nenable-query=true\n");
  value.config.rconPort = 28002; value.config.enableRcon = true;
  const snapshot = ports.snapshotMcNetwork(value);
  assert.equal(snapshot["query.port"], "25565");
  assert.equal(snapshot["rcon.port"], "25575");
  assert.equal(snapshot["enable-rcon"], "false");
  await ports.reservePreservedMcNetwork(value, snapshot, false);
  nativeFs.unlinkSync(propFile(value));
  await ports.assignFreeMcPort(value, undefined, snapshot);
  assert.match(text(value), /query.port=25565/);
  assert.equal(value.config.enableRcon, false);
});
test("reset validate-and-reserve serializes against competing install during delayed OS probe", async () => {
  const value = instance("atomic-reset", false, "server-port=28000\nquery.port=28001\n");
  const snapshot = ports.snapshotMcNetwork(value);
  const gate = { entered: deferred(), resume: deferred() };
  gates.set("tcp6:28000", gate);
  const reserving = ports.reservePreservedMcNetwork(value, snapshot, false);
  await gate.entered.promise;
  nativeFs.unlinkSync(propFile(value));
  const competing = assert.rejects(ports.assignFreeMcPort(instance("racing-install"), 28001), /already in use/);
  await new Promise(setImmediate);
  assert.deepEqual(probes, ["tcp6:28000"]);
  gate.resume.resolve(); await reserving; await competing;
});
test("actual fresh install failure restores pre-provider allocation and releases pending reservation", async () => {
  const task = taskFor(undefined, "serverjar", undefined, { gamePort: 29000 });
  const value = task.instance;
  let password;
  task.installServerJar = async () => {
    assert.match(text(value), /server-port=29000/);
    password = value.config.rconPassword;
    write(value, "server-port=25565\nrcon.password=archive\n");
    throw Error("fresh download failed");
  };
  await task.start();
  assert.match(task.errorInfo.message, /fresh download failed/);
  assert.match(text(value), /server-port=29000/);
  assert.equal(value.config.rconPassword, password);
  assert.match(text(value), new RegExp("rcon.password=" + password));
  await expectReleased(value, 29000);
});

for (const telemetry of ["false", "true", undefined]) {
  test(`Bedrock assign and reset preserve telemetry ${telemetry ?? "absence"} unchanged`, async () => {
    const telemetryLine = telemetry === undefined ? "" : `emit-server-telemetry=${telemetry}\n`;
    const value = instance("telemetry", true, `server-port=20000\nserver-portv6=20001\n${telemetryLine}`);
    await ports.assignFreeBedrockPort(value, 21000);
    const expected = `server-port=21000\nserver-portv6=21001\n${telemetryLine}`;
    assert.equal(text(value), expected);
    const snapshot = ports.snapshotMcNetwork(value);
    await ports.reservePreservedMcNetwork(value, snapshot, true);
    await ports.assignFreeBedrockPort(value, undefined, snapshot);
    assert.equal(text(value), expected);
  });
}

test("Bedrock assign and reset preserve existing properties file mode", async () => {
  const value = instance("mode", true, "server-port=20000\nserver-portv6=20001\n");
  nativeFs.chmodSync(propFile(value), 0o640);
  const mode = nativeFs.statSync(propFile(value)).mode;
  await ports.assignFreeBedrockPort(value, 21000);
  assert.equal(nativeFs.statSync(propFile(value)).mode, mode);
  const snapshot = ports.snapshotMcNetwork(value);
  await ports.reservePreservedMcNetwork(value, snapshot, true);
  await ports.assignFreeBedrockPort(value, undefined, snapshot);
  assert.equal(nativeFs.statSync(propFile(value)).mode, mode);
});

test("short writes fully rewrite UTF-8 properties at offset zero after descriptor read", async () => {
  const value = instance("short-write", true, "server-port=20000\nserver-portv6=20001\nserver-name=世界 🌍\nemit-server-telemetry=false\n");
  maxWriteLength = 3;
  await ports.assignFreeBedrockPort(value, 21000);
  const expected = "server-port=21000\nserver-portv6=21001\nserver-name=世界 🌍\nemit-server-telemetry=false\n";
  assert.equal(text(value), expected);
  assert.equal(nativeFs.statSync(propFile(value)).size, Buffer.byteLength(expected));
  assert.equal(text(value).includes("\0"), false);
  assert.equal(descriptors.size, 0);
});

test("zero-byte write rejects without publishing configuration and closes descriptor", async () => {
  const value = instance("zero-write", true, "server-port=20000\nserver-portv6=20001\n");
  maxWriteLength = 0;
  await assert.rejects(ports.assignFreeBedrockPort(value, 21000), /Could not persist Minecraft network settings/);
  assert.deepEqual(value.config.pingConfig, {});
  assert.equal(stored.length, 0);
  assert.equal(descriptors.size, 0);
  maxWriteLength = Infinity;
  instances.delete(value.instanceUuid);
  assert.equal(await ports.assignFreeBedrockPort(instance("after-zero", true), 21000), 21000);
});

const MAX_PROPERTIES_BYTES = 128 * 1024;
test("oversized owned snapshot and persistence reject before mutating file or config", async () => {
  const original = "server-port=20000\nserver-portv6=20001\n" + "#".repeat(MAX_PROPERTIES_BYTES);
  const value = instance("oversized-owned", true, original);
  const config = JSON.stringify(value.config);
  assert.throws(() => ports.snapshotMcNetwork(value), /exceeds 128 KiB/);
  await assert.rejects(ports.assignFreeBedrockPort(value, 21000), /exceeds 128 KiB/);
  assert.equal(text(value), original);
  assert.equal(JSON.stringify(value.config), config);
  assert.equal(stored.length, 0);
  assert.equal(readBytes.get(propFile(value)), undefined, "reject oversized stat before reading");
  assert.equal(descriptors.size, 0);
});

test("oversized and unreadable neighbors reserve persisted fallback while unrelated creation succeeds", async () => {
  for (const [id, port] of [["oversized-neighbor", 22000], ["unreadable-neighbor", 23000]]) {
    const value = instance(id, true, "server-port=19000\n" + "#".repeat(MAX_PROPERTIES_BYTES));
    value.config.pingConfig.port = port;
    value.config.basePort = port + 2;
    value.config.rconPort = port + 3;
    if (id.startsWith("unreadable")) denied.add(propFile(value));
  }
  const used = ports.getUsedMcPorts();
  for (const port of [22000, 22001, 22002, 22003, 23000, 23001, 23002, 23003]) assert.ok(used.has(port));
  await assert.rejects(ports.assignFreeBedrockPort(instance("conflict", true), 22000), /already in use/);
  assert.equal(await ports.assignFreeBedrockPort(instance("unrelated", true), 24000), 24000);
});

for (const operation of ["snapshot", "persist"]) {
  test("growth after fstat fails " + operation + " with at most cap plus one bytes read", async () => {
    const value = instance("growth", true, "server-port=20000\nserver-portv6=20001\n");
    const original = text(value);
    const grown = original + "#".repeat(MAX_PROPERTIES_BYTES);
    beforeRead = name => {
      assert.equal(name, propFile(value));
      beforeRead = undefined;
      nativeFs.appendFileSync(name, "#".repeat(MAX_PROPERTIES_BYTES));
    };
    maxReadLength = 997;
    if (operation === "snapshot") assert.throws(() => ports.snapshotMcNetwork(value), /exceeds 128 KiB/);
    else await assert.rejects(ports.assignFreeBedrockPort(value, 21000), /exceeds 128 KiB/);
    assert.equal(readBytes.get(propFile(value)), MAX_PROPERTIES_BYTES + 1);
    assert.equal(text(value), grown, "allocator does not truncate or write growing properties");
    assert.deepEqual(value.config.pingConfig, {});
    assert.equal(stored.length, 0);
    assert.equal(descriptors.size, 0);
  });
}

test("short descriptor reads retain full UTF-8 properties through snapshot and persistence", async () => {
  const original = "server-port=20000\nserver-portv6=20001\nserver-name=\u4e16\u754c \ud83c\udf0d\nemit-server-telemetry=custom\n";
  const value = instance("short-read", true, original);
  maxReadLength = 3;
  const snapshot = ports.snapshotMcNetwork(value);
  assert.equal(snapshot["server-portv6"], "20001");
  assert.equal(reads.get(propFile(value)), 1, "short reads are one file scan");
  assert.equal(readBytes.get(propFile(value)), Buffer.byteLength(original));
  await ports.assignFreeBedrockPort(value, 21000);
  assert.equal(text(value), original.replace("20000", "21000").replace("20001", "21001"));
  assert.equal(reads.get(propFile(value)), 2, "persistence performs one further scan");
});

test("properties exactly at the cap remain readable", () => {
  const prefix = "server-port=20000\nserver-portv6=20001\n";
  const value = instance("at-cap", true, prefix + "#".repeat(MAX_PROPERTIES_BYTES - Buffer.byteLength(prefix)));
  assert.equal(ports.snapshotMcNetwork(value)["server-portv6"], "20001");
  assert.equal(readBytes.get(propFile(value)), MAX_PROPERTIES_BYTES);
});

test("CRLF assign and reset preserve exact non-port lines, telemetry, and separators", async () => {
  const original = "# heading\r\n\r\nserver-port =20000\r\nserver-name=keep me\r\n\tserver-portv6\t=20001\r\nemit-server-telemetry=arbitrary-value\r\n# trailing\r\n";
  const value = instance("crlf", true, original);
  const expected = original.replace("server-port =20000", "server-port=21000").replace("\tserver-portv6\t=20001", "server-portv6=21001");
  await ports.assignFreeBedrockPort(value, 21000);
  assert.equal(text(value), expected);
  const snapshot = ports.snapshotMcNetwork(value);
  await ports.reservePreservedMcNetwork(value, snapshot, true);
  await ports.assignFreeBedrockPort(value, undefined, snapshot);
  assert.equal(text(value), expected);
  assert.equal(text(value).replace(/\r\n/g, "").includes("\r"), false);
  assert.equal(text(value).replace(/\r\n/g, "").includes("\n"), false);
});

for (const destinationBedrock of [true, false]) {
  for (const outcome of ["success", "provider failure", "cancel", "backup failure"]) {
    test(`cross-edition reset to ${destinationBedrock ? "Bedrock" : "Java"} preserves original backup and type through ${outcome}`, async () => {
      const original = destinationBedrock
        ? "server-port=28000\nquery.port=28001\nrcon.port=28002\nrcon.password=original\n"
        : "server-port=20000\nserver-portv6=20007\nemit-server-telemetry=false\n";
      const value = instance("crossover", !destinationBedrock, original);
      value.config.pingConfig.port = destinationBedrock ? 28000 : 20000;
      const originalConfig = JSON.stringify(value.config), originalType = value.config.type;
      const task = taskFor(value, destinationBedrock ? "bedrock" : "serverjar", "backup_wipe", { gamePort: 30000 });
      let backups = 0, providers = 0;
      backupCapture = backedUp => {
        backups++;
        assert.equal(backedUp.status(), FakeInstance.STATUS_BUSY);
        assert.equal(text(backedUp), original);
        assert.equal(JSON.stringify(backedUp.config), originalConfig);
        assert.equal(task.networkSnapshot, undefined);
        if (outcome === "backup failure") throw Error("backup failed");
      };
      const provider = async () => {
        providers++;
        assert.equal(backups, 1);
        assert.equal(value.config.type, originalType, "type changes only at successful final parameters");
        assert.equal(task.networkSnapshot["server-port"], "30000");
        if (destinationBedrock) {
          assert.equal(task.networkSnapshot["server-portv6"], "30001");
          for (const key of ["query.port", "rcon.port", "enable-query", "enable-rcon", "rcon.password"])
            assert.equal(task.networkSnapshot[key], undefined, key + " must not acquire Java defaults");
        } else {
          assert.equal(task.networkSnapshot["server-portv6"], undefined);
          assert.ok(task.networkSnapshot["rcon.port"]);
        }
        if (outcome === "provider failure") { write(value, "server-port=25565\n"); throw Error("provider failed"); }
        if (outcome === "cancel") await task.stop();
        return destinationBedrock ? "./bedrock_server" : "java -jar server.jar";
      };
      if (destinationBedrock) task.installBedrock = provider;
      else task.installServerJar = provider;
      await task.start();
      assert.equal(backups, 1);
      assert.equal(providers, outcome === "backup failure" ? 0 : 1);
      if (outcome === "success") {
        assert.equal(task.errorInfo, undefined);
        assert.equal(task.phase, "done");
        assert.equal(value.config.type, destinationBedrock ? "minecraft/bedrock" : "minecraft/java");
      } else {
        assert.match(task.errorInfo.message, outcome === "cancel" ? /cancelled/ : outcome === "backup failure" ? /backup failed/ : /provider failed/);
        assert.equal(value.config.type, originalType);
      }
      if (outcome === "backup failure") {
        assert.equal(text(value), original);
        assert.equal(JSON.stringify(value.config), originalConfig);
        assert.equal(stored.length, 0);
      } else {
        assert.match(text(value), /server-port=30000/);
        if (destinationBedrock) assert.doesNotMatch(text(value), /query.port|rcon.port|enable-rcon/);
        await expectReleased(value, 30000);
      }
    });
  }
}

test("actual installBedrock enables telemetry only after successful port assignment", async () => {
  const value = instance("bedrock-install", true);
  const task = taskFor(value, "bedrock", undefined, { gamePort: 21000, bedrockUrl: "https://example.test/bds.zip" });
  task.downloadWithProgress = async () => {};
  extractBedrock = async () => write(value, "server-port=19132\nserver-portv6=19133\nemit-server-telemetry=false\n");
  let calls = 0;
  beforeTelemetry = (inst, key, setting) => {
    calls++;
    assert.equal(inst, value); assert.equal(key, "emit-server-telemetry"); assert.equal(setting, "true");
    assert.match(text(value), /server-port=21000/);
    assert.equal(value.config.pingConfig.port, 21000);
  };
  assert.match(await task.installBedrock(), /bedrock_server/);
  assert.equal(calls, 1);
  assert.match(text(value), /emit-server-telemetry=true/);
  errors.set("udp4:22000", "EADDRINUSE");
  task.descriptor.gamePort = 22000;
  await assert.rejects(task.installBedrock(), /already in use/);
  assert.equal(calls, 1, "failed allocation must not write telemetry");
});

test("actual installBedrock telemetry safe-path rejection and write errors remain nonfatal", async () => {
  for (const boundary of [true, false]) {
    const value = instance("telemetry-failure-" + boundary, true);
    const task = taskFor(value, "bedrock", undefined, { gamePort: boundary ? 21000 : 22000, bedrockUrl: "https://example.test/bds.zip" });
    task.downloadWithProgress = async () => {};
    extractBedrock = async () => write(value, "server-port=19132\nserver-portv6=19133\nemit-server-telemetry=false\n");
    const outside = path.join(root, "telemetry-outside-" + boundary);
    nativeFs.mkdirSync(outside);
    const sentinel = path.join(outside, "server.properties"), original = "emit-server-telemetry=outside\n";
    nativeFs.writeFileSync(sentinel, original);
    let rejected = false;
    beforeTelemetry = () => {
      if (!boundary) { rejected = true; throw Error("telemetry write denied"); }
      nativeFs.unlinkSync(propFile(value));
      try { nativeFs.symlinkSync(sentinel, propFile(value), "file"); }
      catch (error) {
        if (process.platform !== "win32" || error.code !== "EPERM") throw error;
        nativeFs.rmdirSync(value.absoluteCwdPath());
        nativeFs.symlinkSync(outside, value.absoluteCwdPath(), "junction");
      }
      assert.throws(() => setServerProperty(value, "emit-server-telemetry", "true"), /links|junctions/i);
      rejected = true;
    };
    assert.match(await task.installBedrock(), /bedrock_server/);
    assert.equal(rejected, true);
    assert.equal(nativeFs.readFileSync(sentinel, "utf8"), original);
    if (!boundary) assert.match(text(value), /emit-server-telemetry=false/);
    instances.delete(value.instanceUuid);
  }
});


// Real wake service + OS sockets: only the target UUID is suspended; all port probes still run.
async function waitForWake(predicate) {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "wake listener state did not settle");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function wakeTcp(port = 0) {
  const server = nativeNet.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host: "0.0.0.0" }, resolve);
  });
  return server;
}
const closeWakeSocket = socket => new Promise(resolve => socket.close(resolve));
async function sleepingInstance(t, id) {
  const temporary = await wakeTcp();
  const port = temporary.address().port;
  await closeWakeSocket(temporary);
  const value = instance(id, false, "server-port=" + port + "\nquery.port=" + port + "\nenable-query=false\nrcon.port=" + port + "\nenable-rcon=false\n");
  Object.setPrototypeOf(value, EventEmitter.prototype);
  EventEmitter.call(value);
  value.config.sleepOnEmpty = { enabled: true, wakeOnJoin: true };
  value.config.pingConfig.port = port;
  wakeService.applyForInstance(value);
  await waitForWake(() => wakeService.servers.get(id)?.listening);
  t.after(async () => {
    value.config.sleepOnEmpty.enabled = false;
    const resume = await wakeService.suspendForInstance(value);
    resume();
    useActualWake = false;
  });
  return value;
}

for (const outcome of ["success", "provider failure", "cancel", "backup failure"]) {
  test("wake reset scoped listener cleanup through " + outcome, async t => {
    useActualWake = true; useRealSockets = true;
    const value = await sleepingInstance(t, "wake-reset-" + outcome);
    const neighbor = await sleepingInstance(t, "wake-neighbor-" + outcome);
    const neighborServer = wakeService.servers.get(neighbor.instanceUuid);
    const port = value.config.pingConfig.port;
    const client = nativeNet.connect({ port, host: "127.0.0.1" });
    client.on("error", () => {});
    t.after(() => client.destroy());
    await new Promise(resolve => client.once("connect", resolve));
    await waitForWake(() => wakeService.connections.get(value.instanceUuid)?.size === 1);
    let starts = 0;
    value.execPreset = async () => { starts++; };
    const task = taskFor(value, "serverjar", outcome === "backup failure" ? "backup_wipe" : "wipe");
    backupCapture = () => { throw Error("wake backup failed"); };
    task.installServerJar = async () => {
      assert.equal(wakeService.servers.has(value.instanceUuid), false);
      value.emit("exit");
      wakeService.applyForInstance(value);
      wakeService.openListener(value);
      wakeService.triggerWake(value);
      assert.equal(wakeService.servers.has(value.instanceUuid), false);
      assert.equal(starts, 0);
      if (outcome === "provider failure") throw Error("wake provider failed");
      if (outcome === "cancel") await task.stop();
      return "java -jar server.jar";
    };
    await task.start();
    if (outcome === "success") assert.equal(task.errorInfo, undefined);
    else assert.match(task.errorInfo.message, outcome === "cancel" ? /cancelled/ : /wake .* failed/);
    assert.equal(value.status(), FakeInstance.STATUS_STOP);
    await waitForWake(() => wakeService.servers.get(value.instanceUuid)?.listening);
    assert.equal(wakeService.servers.get(neighbor.instanceUuid), neighborServer);
    assert.equal(neighborServer.listening, true);
    assert.equal(wakeService.suspensions.has(value.instanceUuid), false);
    assert.equal(wakeService.closing.has(value.instanceUuid), false);
    assert.equal(starts, 0);
  });
}

for (const protocol of ["query", "rcon"]) {
  test("wake reset still rejects external " + protocol + " conflict before BUSY and rearms own listener", async t => {
    useActualWake = true; useRealSockets = true;
    const value = await sleepingInstance(t, "wake-conflict-" + protocol);
    const external = protocol === "query" ? nativeDgram.createSocket("udp4") : await wakeTcp();
    if (protocol === "query") await new Promise(resolve => external.bind(0, "0.0.0.0", resolve));
    t.after(() => closeWakeSocket(external));
    const original = text(value) + (protocol === "query"
      ? "query.port=" + external.address().port + "\nenable-query=true\n"
      : "rcon.port=" + external.address().port + "\nenable-rcon=true\n");
    write(value, original);
    const task = taskFor(value);
    task.installServerJar = async () => assert.fail("validation must fail before provider");
    await task.start();
    assert.match(task.errorInfo.message, /already in use/);
    assert.equal(value.status(), FakeInstance.STATUS_STOP);
    assert.equal(text(value), original);
    assert.equal(value.asynchronousTask, undefined);
    await waitForWake(() => wakeService.servers.get(value.instanceUuid)?.listening);
    assert.equal(wakeService.suspensions.has(value.instanceUuid), false);
  });
}

test("wake suspension still detects external game listener and cancels pending bind retries", async t => {
  useRealSockets = true;
  const value = await sleepingInstance(t, "wake-game-conflict");
  const wakeAddress = wakeService.servers.get(value.instanceUuid).address();
  assert.ok(wakeAddress && typeof wakeAddress !== "string");
  const resume = await wakeService.suspendForInstance(value);
  let external = await wakeTcp(value.config.pingConfig.port);
  let resumeAgain;
  try {
    // Keep the IPv4 OS-conflict check even when the wake listener binds IPv6.
    await assert.rejects(ports.reservePreservedMcNetwork(value, ports.snapshotMcNetwork(value), false), /already in use/);
    await closeWakeSocket(external);
    // On Windows an IPv4 wildcard can coexist with the wake listener's default
    // IPv6 bind. Occupy its actual address so resume must exercise bind retries.
    external = nativeNet.createServer();
    await new Promise((resolve, reject) => {
      external.once("error", reject);
      external.listen({ port: value.config.pingConfig.port, host: wakeAddress.address }, resolve);
    });
    assert.equal(external.address().family, wakeAddress.family);
    resume();
    await waitForWake(() => wakeService.retryTimers.get(value.instanceUuid)?.size > 0);
    resumeAgain = await wakeService.suspendForInstance(value);
    assert.equal(wakeService.retryTimers.has(value.instanceUuid), false);
    assert.equal(wakeService.refreshTimers.has(value.instanceUuid), false);
    value.emit("exit");
    wakeService.openListener(value, 1);
    wakeService.triggerWake(value);
    assert.equal(wakeService.servers.has(value.instanceUuid), false);
    await closeWakeSocket(external);
    resumeAgain();
    await waitForWake(() => wakeService.servers.get(value.instanceUuid)?.listening);
  } finally {
    if (external.listening) await closeWakeSocket(external);
    resumeAgain?.();
    resume();
  }
});

test("wake suspension resume follows actual disabled, running, and Bedrock state", async t => {
  for (const state of ["disabled", "running", "bedrock"]) {
    const value = await sleepingInstance(t, "wake-final-" + state);
    const resume = await wakeService.suspendForInstance(value);
    if (state === "disabled") value.config.sleepOnEmpty.enabled = false;
    if (state === "running") value.status(3);
    if (state === "bedrock") value.config.type = "minecraft/bedrock";
    resume();
    assert.equal(wakeService.servers.has(value.instanceUuid), false);
    assert.equal(wakeService.refreshTimers.has(value.instanceUuid), false);
    assert.equal(wakeService.suspensions.has(value.instanceUuid), false);
  }
});

test("wake suspension close timeout rejects safely and releases the scope", { timeout: 3500 }, async () => {
  const value = instance("wake-close-timeout");
  Object.setPrototypeOf(value, EventEmitter.prototype);
  EventEmitter.call(value);
  let finishClose;
  wakeService.servers.set(value.instanceUuid, { close: done => { finishClose = done; } });
  try {
    await assert.rejects(wakeService.suspendForInstance(value), /listener close timed out/);
    assert.equal(value.status(), FakeInstance.STATUS_STOP);
    assert.equal(wakeService.suspensions.has(value.instanceUuid), false);
    assert.equal(wakeService.refreshTimers.has(value.instanceUuid), false);
  } finally {
    finishClose();
    await waitForWake(() => !wakeService.closing.has(value.instanceUuid));
  }
});
