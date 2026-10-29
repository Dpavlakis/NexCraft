"use strict";

// Full source modules run with explicit I/O boundaries; no daemon, HTTP server,
// downloads, Minecraft process, production data, or global require hooks.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const dep = createRequire(path.join(root, "daemon/package.json"));
const ts = dep("typescript");
const realFs = dep("fs-extra");
const compiled = new Map();
function sourceModule(file, dependencies = {}, extra = "", source) {
  const filename = path.join(root, file);
  const key = file + extra;
  if (!compiled.has(key)) {
    const js = ts.transpileModule((source ?? fs.readFileSync(filename, "utf8")) + extra, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText;
    compiled.set(key, vm.runInThisContext("(function(require,module,exports){" + js + "\n})", { filename }));
  }
  const mod = { exports: {} };
  compiled.get(key)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Uncontrolled dependency ${name} in ${file}`);
    return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}
const translate = { $t: key => key };
const log = { info() {}, warn() {}, error() {} };
const forbidden = () => { throw new Error("Unexpected network/download/process boundary"); };
const javaTypes = sourceModule("daemon/src/entity/commands/java/java_manager.ts");
const parser = sourceModule("daemon/src/entity/commands/base/command_parser.ts", { "../../../i18n": translate });
const common = sourceModule("common/src/typecheck.ts");

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexcraft-java-selection-"));
  // Check the resolved target before recursive cleanup; only our mkdtemp tree.
  const inside = file => {
    const relative = path.relative(dir, path.resolve(file));
    assert.ok(relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative), file);
  };
  t.after(() => { inside(dir); fs.rmSync(dir, { recursive: true, force: true }); });
  let failSave = false;
  const guardedFs = { ...realFs };
  for (const name of ["mkdirsSync", "writeFileSync", "remove", "removeSync", "mkdirpSync"]) {
    guardedFs[name] = (file, ...args) => {
      inside(file);
      if (failSave && name === "writeFileSync") {
        if (failSave === "partial") realFs.writeFileSync(file, "{partial candidate");
        throw new Error("fixture disk write denied");
      }
      return realFs[name](file, ...args);
    };
  }
  guardedFs.renameSync = (from, to) => { inside(from); inside(to); return realFs.renameSync(from, to); };
  const Storage = sourceModule("common/src/system_storage.ts", { "fs-extra": guardedFs, path }).default;
  Storage.DATA_PATH = path.join(dir, "data");
  Storage.INDEX_PATH = path.join(dir, "data/index");
  const storage = new Storage();
  const system = new EventEmitter();
  const instances = new Map();
  system.getInstance = id => instances.get(id);
  system.instances = instances;
  const configBoundary = { globalConfiguration: { config: {
    defaultJavaDataPath: path.join(dir, "data/JavaData"), outputBufferSize: 32, portAssignInterval: 1
  } } };
  // The constructor's fire-and-forget initial scan is deterministically empty.
  // Subsequent loadJavaList calls use the real disposable filesystem.
  let initialScan = true;
  const javaFs = { ...guardedFs, readdir: (...args) => {
    if (initialScan) { initialScan = false; return Promise.resolve([]); }
    return realFs.readdir(...args);
  } };
  const downloadBoundary = { downloadFromUrl: forbidden };
  const java = sourceModule("daemon/src/service/java_manager.ts", {
    axios: { get: forbidden }, "async-mutex": dep("async-mutex"), child_process: { spawn: forbidden }, "fs-extra": javaFs,
    "../entity/commands/base/command_parser": parser,
    os, path, tar: { extract: forbidden }, url: require("node:url"),
    "../common/system_storage": storage, "../entity/commands/java/java_manager": javaTypes,
    "../entity/config": configBoundary, "../i18n": translate,
    "./download_manager": downloadBoundary, "./log": log,
    "./system_file": class {}, "./system_instance": system
  }).default;
  await Promise.resolve();
  const Instance = sourceModule("daemon/src/entity/instance/instance.ts", {
    crypto: require("node:crypto"), events: require("node:events"), i18next: { t: key => key },
    "iconv-lite": dep("iconv-lite"), "mcsmanager-common": { ...common, StorageSubsystem: Storage }, "fs-extra": guardedFs, path,
    "../../common/string_cache": sourceModule("daemon/src/common/string_cache.ts"),
    "../../common/system_storage": storage, "../../const": { STEAM_CMD_PATH: "unused" },
    "../../i18n": translate, "../../service/java_manager": java, "../../service/log": log,
    "../../service/scheduled_restart_service": { applyForInstance() {} },
    "../../service/wake_listener_service": { applyForInstance() {} },
    "../commands/base/command_parser": parser,
    "../commands/dispatcher": class {}, "../config": configBoundary,
    "./life_cycle": sourceModule("daemon/src/entity/instance/life_cycle.ts"),
    "./preset": sourceModule("daemon/src/entity/instance/preset.ts", { "../../i18n": translate })
  }).default;
  const Config = sourceModule("daemon/src/entity/instance/Instance_config.ts", { os, "./instance": Instance }).default;
  const handlers = new Map();
  sourceModule("daemon/src/routers/java_manager_router.ts", {
    path, "../entity/commands/base/command_parser": parser,
    "../entity/commands/java/java_manager": javaTypes, "../i18n": translate,
    "../service/java_manager": java,
    "../service/protocol": {
      response: (ctx, value) => { ctx.value = value; },
      responseError: (ctx, error) => { ctx.error = error; }
    },
    "../service/router": { routerApp: { on: (name, fn) => handlers.set(name, fn) } },
    "../service/system_file": class {}, "../service/system_instance": system
  });
  const rpc = async (name, payload) => {
    const ctx = {};
    await handlers.get(name)(ctx, payload);
    if (ctx.error) throw ctx.error;
    return ctx.value;
  };
  // Transport and authorization middleware are outside this bounded test;
  // execute the real panel route body, forwarding to the real daemon route.
  class Router {
    routes = new Map();
    use() {}
    get(route, ...chain) { this.routes.set("GET " + route, chain.at(-1)); }
    post(route, ...chain) { this.routes.set("POST " + route, chain.at(-1)); }
    delete(route, ...chain) { this.routes.set("DELETE " + route, chain.at(-1)); }
  }
  const panel = sourceModule("panel/src/app/routers/java_manager_router.ts", {
    "@koa/router": Router, "../entity/user": { ROLE: { USER: 1, ADMIN: 10 } },
    "../middleware/permission": () => {}, "../middleware/validator": () => {},
    "../middleware/limit": { speedLimit() {} }, "../i18n": translate,
    "../service/passport_service": { getUserUuid() {} },
    "../service/permission_service": { isHaveInstanceByUuid() {} },
    "../service/remote_service": { getInstance: id => { assert.equal(id, "fixture-node"); return {}; } },
    "../service/remote_command": class { async request(name, payload) { return rpc(name, payload); } }
  }).default;
  const apiCalls = [];
  const api = sourceModule("frontend/src/services/apis/javaManager.ts", {
    "@/stores/useDefineApi": { useDefineApi: options => () => ({ execute: async args => {
      apiCalls.push({ options, args });
      const route = options.url.replace("/api/java_manager", "");
      const ctx = { query: args.params, request: { body: args.data } };
      await panel.routes.get(options.method + " " + route)(ctx);
      return { value: ctx.body };
    } }) }
  });
  const messages = [];
  const ui = instance => {
    const file = "frontend/src/widgets/instance/dialogs/JavaManager.vue";
    const script = fs.readFileSync(path.join(root, file), "utf8").match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
    const props = { instanceInfo: { config: structuredClone(instance.config) }, daemonId: "fixture-node", instanceId: instance.instanceUuid };
    // Bind compiler macros locally; execute the original script's handlers and render callbacks.
    const loaded = sourceModule(file, {
      "@/components/fc": {}, "@/lang/i18n": { t: key => key },
      "@/services/apis/instance": { getInstanceInfo: () => ({ execute: async args => {
        assert.equal(args.forceRequest, true);
        assert.deepEqual(args.params, { daemonId: "fixture-node", uuid: instance.instanceUuid });
        return { value: { config: structuredClone(storage.load("InstanceConfig", Config, instance.instanceUuid)) } };
      } }) },
      "@/services/apis/javaManager": api, "@/tools/time": { parseTimestamp: String },
      "@ant-design/icons-vue": {}, "ant-design-vue": { message: {
        success: msg => messages.push(["success", msg]), error: msg => messages.push(["error", msg])
      } }, vue: { h() {}, onBeforeUnmount() {}, ref: value => ({ value }) },
      "fixture-macros": { defineProps: () => props, defineExpose() {} }
    }, "\nmodule.exports = { handleUsingJava, columns };", 'import { defineProps, defineExpose } from "fixture-macros";\n' + script);
    return { ...loaded, props };
  };
  const command = sourceModule("daemon/src/entity/commands/base/command.ts").default;
  const Start = sourceModule("daemon/src/entity/commands/start.ts", {
    "fs-extra": guardedFs, "../../i18n": translate,
    "../../service/disk_limit_service": {}, "../instance/instance": Instance,
    "./base/command": command
  }).default;
  const launches = [];
  let actualVersion = false;
  let missingExecutable = false;
  const versionRuns = [];
  let beforeSpawn;
  const GeneralStart = sourceModule("daemon/src/entity/commands/general/general_start.ts", {
    child_process: { spawn: (exe, args, options) => {
      inside(options.cwd);
      launches.push({ exe, args, options });
      if (actualVersion) {
        assert.deepEqual(args, ["-version"]);
        assert.ok(realJavaHomes().some(home => javaExe(home) === exe), "Only known installed Java -version allowed");
        const child = spawn(exe, args, { ...options, timeout: 10000 });
        const run = { exe, output: "" };
        child.stdout.on("data", data => { run.output += data; });
        child.stderr.on("data", data => { run.output += data; });
        run.done = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", code => { run.code = code; resolve(); }); });
        versionRuns.push(run);
        return child;
      }
      const child = new EventEmitter();
      child.pid = missingExecutable ? undefined : 12345;
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdout.destroy = () => {}; child.stderr.destroy = () => {};
      child.stdin = { write() {} }; child.kill = forbidden;
      queueMicrotask(() => child.emit(missingExecutable ? "error" : "spawn", missingExecutable ? new Error("ENOENT fixture executable disappeared") : undefined));
      return child;
    } }, events: require("node:events"), "fs-extra": guardedFs,
    "mcsmanager-common": { killProcess: forbidden }, "../../../i18n": translate,
    "../../../service/log": log, "../../../tools/system_user": { getRunAsUserParams: async () => { if (beforeSpawn) await beforeSpawn(); return { isEnableRunAs: false }; } },
    "../../instance/instance": Instance, "../base/command_parser": parser, "../start": Start
  }).default;
  const ptyLaunches = [], ptyUnhandledErrors = [];
  const ptyPath = path.join(dir, "pty-helper");
  fs.writeFileSync(ptyPath, "fixture marker; never executed");
  const PtyStart = sourceModule("daemon/src/entity/commands/pty/pty_start.ts", {
    child_process: { spawn: (exe, args, options) => {
      assert.equal(exe, ptyPath); inside(options.cwd);
      ptyLaunches.push({ exe, args, options });
      const child = new EventEmitter();
      child.stdout = { destroy() {} }; child.stderr = { destroy() {} };
      // Match Node's asynchronous ENOENT after spawn returned without a PID.
      queueMicrotask(() => {
        try { child.emit("error", new Error("ENOENT fixture PTY helper disappeared")); }
        catch (error) { ptyUnhandledErrors.push(error); }
      });
      return child;
    } }, events: require("node:events"),
    "fs-extra": { ...guardedFs, existsSync: file => file === "/tmp/mcsmanager-instance-pipe" || guardedFs.existsSync(file) },
    "mcsmanager-common": { killProcess: forbidden }, os, path,
    readline: require("node:readline"), stream: require("node:stream"), uuid: { v4: () => "fixture-pipe" },
    "../../../const": { PTY_PATH: ptyPath }, "../../../i18n": translate,
    "../../../service/log": log, "../../../tools/system_user": { getRunAsUserParams: async () => { if (beforeSpawn) await beforeSpawn(); return { isEnableRunAs: false }; } },
    "../../instance/instance": Instance, "../base/command_parser": parser, "../dispatcher": class {}, "../start": Start
  }).default;
  const bootstrap = sourceModule("daemon/src/service/modloader_bootstrap.ts", {
    axios: { get: forbidden }, child_process: { spawn: forbidden }, "fs-extra": guardedFs,
    "iconv-lite": dep("iconv-lite"), "mcsmanager-common": { killProcess: forbidden }, os, path,
    "../common/network": { getCommonHeaders: () => ({}) }, "../entity/instance/instance": Instance,
    "../i18n": translate, "./download_manager": { downloadFromUrl: forbidden },
    "./java_manager": java, "./log": log
  });
  function instance(startCommand = "java -Xmx1G -jar server.jar nogui") {
    const cfg = new Config(); cfg.cwd = path.join(dir, "workspace"); cfg.basePort = 25565;
    cfg.startCommand = startCommand; cfg.terminalOption.pty = false;
    const value = new Instance("instance-" + instances.size, cfg);
    value.output = [];
    value.println = (...args) => value.output.push(args);
    // Observe runtime attachment without arming Minecraft timers/output loops.
    value.started = process => { value.process = process; value.status(Instance.STATUS_RUNNING); system.emit("open", { instanceUuid: value.instanceUuid }); };
    value.on("failure", () => system.emit("failure", { instanceUuid: value.instanceUuid }));
    value.on("exit", () => system.emit("exit", { instanceUuid: value.instanceUuid }));
    instances.set(value.instanceUuid, value);
    return value;
  }
  function install(name, version, home = path.join(dir, "installed " + name)) {
    const info = new javaTypes.JavaInfo(name, Date.now(), version); info.path = home;
    if (home.startsWith(dir + path.sep)) { fs.mkdirSync(path.join(home, "bin"), { recursive: true }); fs.writeFileSync(javaExe(home), "fixture marker; never executable"); fs.chmodSync(javaExe(home), 0o755); }
    java.addJava(info); return info;
  }
  return { dir, java, storage, Config, Instance, instance, install, ui, messages, apiCalls, rpc, system,
    start: value => new GeneralStart().createProcess(value), launches, versionRuns,
    ptyLaunches, ptyUnhandledErrors,
    async execPtyStart(value) {
      const start = new PtyStart(); start.sleep = async () => {};
      value.setPreset("kill", { async exec() {} });
      return start.exec(value);
    },
    actualVersions() { actualVersion = true; }, missingExecutable() { missingExecutable = true; },
    io: { java: javaFs, storage: guardedFs, download: downloadBoundary },
    pauseBeforeSpawn(callback) { beforeSpawn = callback; },
    async execStart(value) {
      const start = new GeneralStart(); start.sleep = async () => {};
      value.setPreset("kill", { async exec() {} });
      return start.exec(value);
    },
    failSave(mode = true) { failSave = mode; },
    bootstrap: value => new bootstrap.ModloaderBootstrap({ instance: value, mcVersion: "1.21.1" }) };
}
function javaExe(home) { return path.join(home, "bin", process.platform === "win32" ? "java.exe" : "java"); }
function realJavaHomes() {
  // Optional integration check: explicit opt-in homes, or known conventional local installs.
  const homes = process.env.NEXCRAFT_TEST_JAVA_HOMES?.split(path.delimiter) ?? (process.platform === "win32"
    ? ["C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot", "C:\\Program Files\\Java\\jdk-21.0.10"]
    : ["/usr/lib/jvm/java-21-openjdk-amd64", "/usr/lib/jvm/java-17-openjdk-amd64"]);
  return [...new Set(homes)].filter(home => fs.existsSync(javaExe(home)));
}

test("UI → frontend API → panel → daemon persists A then B and resolves each executable at the spawn boundary", async t => {
  const f = await fixture(t), value = f.instance(), view = f.ui(value);
  const a = f.install("fixture-a", "17.0.1"), b = f.install("fixture-b", "21.0.1");
  for (const info of [a, b]) {
    await view.handleUsingJava(info);
    assert.equal(value.config.java.id, info.fullname);
    const restored = f.storage.load("InstanceConfig", f.Config, value.instanceUuid);
    assert.equal(restored.java.id, info.fullname);
    assert.equal(restored.startCommand, "{mcsm_java} -Xmx1G -jar server.jar nogui");
    const reloaded = f.instance(restored.startCommand); reloaded.config = restored;
    await f.start(reloaded);
    assert.equal(f.launches.at(-1).exe, javaExe(info.path));
    assert.deepEqual(f.launches.at(-1).args, ["-Xmx1G", "-jar", "server.jar", "nogui"]);
    assert.equal(view.props.instanceInfo.config.java.id, info.fullname);
    assert.equal(view.props.instanceInfo.config.startCommand, restored.startCommand);
  }
  assert.equal(f.apiCalls.filter(call => call.options.url.endsWith("/using")).length, 2);
  // Metadata survives a real Java catalog reload too.
  f.java.javaList.clear(); await f.java.loadJavaList();
  assert.equal(await f.java.getJavaRuntimeCommand(b.fullname), '"' + javaExe(b.path) + '"');
});

test("selecting a quoted Java launcher preserves the remaining command verbatim", async t => {
  const suffix = '  -jar "server files/server.jar" "-Dmessage=hello world" nogui';
  const f = await fixture(t), value = f.instance('"/old java/bin/java"' + suffix);
  const info = f.install("fixture", "21");
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: info.fullname });
  await f.start(value);
  assert.equal(value.config.startCommand, "{mcsm_java}" + suffix);
  assert.deepEqual(f.launches[0].args, ["-jar", "server files/server.jar", "-Dmessage=hello world", "nogui"]);
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: info.fullname });
  assert.equal(value.config.startCommand, "{mcsm_java}" + suffix);
});

test("script selection rejects actionably and preserves script, memory and saved configuration", async t => {
  const f = await fixture(t), value = f.instance("bash startserver.sh"), info = f.install("fixture", "21");
  value.parameters({ startCommand: value.config.startCommand });
  const before = JSON.stringify(value.config);
  await assert.rejects(f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: info.fullname }), /TXT_CODE_java_selection.scriptLauncher/);
  assert.equal(JSON.stringify(value.config), before);
  assert.equal(f.storage.load("InstanceConfig", f.Config, value.instanceUuid).java.id, "");
  await f.start(value);
  assert.equal(f.launches[0].exe, "bash");
  assert.deepEqual(f.launches[0].args, ["startserver.sh"]);
});

test("running instance keeps its existing process; next launch uses newly persisted Java", async t => {
  const f = await fixture(t), value = f.instance(), a = f.install("a", "17"), b = f.install("b", "21");
  await f.ui(value).handleUsingJava(a); await f.start(value);
  const processBefore = value.process;
  await f.ui(value).handleUsingJava(b);
  assert.equal(value.process, processBefore); assert.equal(f.launches.length, 1);
  assert.equal(value.status(), f.Instance.STATUS_RUNNING);
  value.releaseResources(); value.status(f.Instance.STATUS_STOP);
  await f.start(value); assert.equal(f.launches[1].exe, javaExe(b.path));
});

test("configured stopped runtime has no live usage; exit and failure clear launched usage", async t => {
  const f = await fixture(t), value = f.instance(), info = f.install("fixture", "21"), view = f.ui(value);
  await view.handleUsingJava(info);
  const runtime = f.java.getJava(info.fullname);
  assert.equal(view.props.instanceInfo.config.java.id, info.fullname);
  assert.deepEqual(runtime.usingInstances, []);
  await f.start(value);
  assert.deepEqual(runtime.usingInstances, [value.instanceUuid]);
  value.stopped(); f.system.emit("exit", { instanceUuid: value.instanceUuid });
  f.system.emit("failure", { instanceUuid: value.instanceUuid });
  assert.equal(value.status(), f.Instance.STATUS_STOP);
  assert.deepEqual(runtime.usingInstances, []);
  await assert.rejects(f.java.removeJava(info.fullname), /TXT_CODE_ea8ea5d1/);
});

test("both running A and pending B are protected; cleanup releases A independently of B", async t => {
  const f = await fixture(t), value = f.instance(), a = f.install("a", "17"), b = f.install("b", "21");
  const view = f.ui(value); await view.handleUsingJava(a); await f.start(value); await view.handleUsingJava(b);
  assert.deepEqual(f.java.getJava(b.fullname).usingInstances, []);
  await assert.rejects(f.java.removeJava(a.fullname), /TXT_CODE_ea8ea5d1/);
  await assert.rejects(f.java.removeJava(b.fullname), /TXT_CODE_ea8ea5d1/);
  assert.equal(value.config.java.id, b.fullname);
  f.system.emit("exit", { instanceUuid: value.instanceUuid });
  assert.deepEqual(f.java.getJava(a.fullname).usingInstances, []);
  await f.java.removeJava(a.fullname);
  assert.equal(f.java.exists(a.fullname), false);
});

test("unknown and downloading Java IDs are rejected before persistence", async t => {
  const f = await fixture(t), value = f.instance(), info = f.install("pending", "21");
  f.java.getJava(info.fullname).info.downloading = true;
  for (const [id, error] of [["does-not-exist", /TXT_CODE_77ce8542/], [info.fullname, /TXT_CODE_45d02bb7/]]) {
    await assert.rejects(f.rpc("java_manager/using", { instanceId: value.instanceUuid, id }), error);
    assert.equal(value.config.java.id, "");
    assert.equal(f.storage.load("InstanceConfig", f.Config, value.instanceUuid), null);
  }
  assert.equal(f.launches.length, 0);
});

test("deleting a stopped selected runtime is rejected and the saved selection still launches", async t => {
  const f = await fixture(t), value = f.instance(), info = f.install("fixture", "21");
  await f.ui(value).handleUsingJava(info);
  await assert.rejects(f.rpc("java_manager/delete", { id: info.fullname }), /TXT_CODE_ea8ea5d1/);
  assert.equal(f.storage.load("InstanceConfig", f.Config, value.instanceUuid).java.id, info.fullname);
  await f.start(value);
  assert.equal(f.launches.at(-1).exe, javaExe(info.path));
});

test("missing executable is rejected at launch before spawn", async t => {
  const f = await fixture(t), value = f.instance(), info = f.install("fixture", "21");
  await f.ui(value).handleUsingJava(info); fs.unlinkSync(javaExe(info.path));
  await assert.rejects(f.java.getJavaRuntimeCommand(info.fullname), /TXT_CODE_java_selection.executableUnavailable/);
  await assert.rejects(f.start(value), /TXT_CODE_java_selection.executableUnavailable/);
  assert.equal(f.launches.length, 0);
});

test("failed selection save leaves UI, memory and disk on the original runtime", async t => {
  const f = await fixture(t), value = f.instance(), a = f.install("a", "17"), b = f.install("b", "21");
  const view = f.ui(value); await view.handleUsingJava(a); f.messages.length = 0; f.failSave();
  await view.handleUsingJava(b);
  assert.deepEqual(f.messages, [["error", "fixture disk write denied"]]);
  assert.equal(view.props.instanceInfo.config.java.id, a.fullname);
  assert.equal(f.storage.load("InstanceConfig", f.Config, value.instanceUuid).java.id, a.fullname);
  assert.equal(value.config.java.id, a.fullname);
  await assert.rejects(f.rpc("java_manager/using", { instanceId: "missing", id: b.fullname }), /TXT_CODE_ef6b54fb/);
});

test("provisioner respects explicit selection, reuses matching installed runtime, and skips matching system Java", async t => {
  const f = await fixture(t), value = f.instance(), info = f.install("installed", "21.0.1");
  assert.equal(await f.java.ensureJavaMajor(21), info.fullname);
  const boot = f.bootstrap(value); let resolves = 0;
  boot.resolveRequiredJavaMajor = async () => { resolves++; return 21; };
  f.java.getSystemJavaMajor = async () => 17;
  value.config.java.id = "explicit-choice";
  await boot.ensureJava(); assert.equal(resolves, 0); assert.equal(value.config.java.id, "explicit-choice");
  value.config.java.id = "";
  await boot.ensureJava(); assert.equal(value.config.java.id, info.fullname); assert.equal(boot.startJavaToken(), "{mcsm_java}");
  value.config.java.id = ""; f.java.getSystemJavaMajor = async () => 21;
  await boot.ensureJava(); assert.equal(value.config.java.id, ""); assert.equal(boot.startJavaToken(), "java");
});

test("provisioning failure is reported, without binding a runtime or retrying a launch", async t => {
  const f = await fixture(t), value = f.instance(), boot = f.bootstrap(value);
  boot.resolveRequiredJavaMajor = async () => 25; f.java.getSystemJavaMajor = async () => 21;
  f.java.downloadAndInstall = async () => { throw new Error("fixture offline"); };
  await boot.ensureJava();
  assert.equal(value.config.java.id, "");
  assert.ok(value.output.some(line => line[0] === "WARN" && line[1] === "TXT_CODE_modpack.javaAutoFailed"));
  value.output.length = 0; await value.tryAutoJavaFix(25);
  assert.ok(value.output.some(line => line[0] === "ERROR" && line[1] === "fixture offline"));
  assert.equal(f.launches.length, 0);
});

test("real download/install failure removes its disposable partial catalog entry and directory", async t => {
  const f = await fixture(t), info = new javaTypes.JavaInfo("partial", Date.now(), "25");
  await assert.rejects(f.java.downloadAndInstall(info, "https://example.invalid/runtime.zip"), /Unexpected network\/download\/process boundary/);
  assert.equal(f.java.exists(info.fullname), false);
  assert.equal(fs.existsSync(path.join(f.java.getJavaDataDir(), info.fullname)), false);
});

test("startup mismatch can override manual Java choice, persist replacement, and request one retry", async t => {
  const f = await fixture(t), value = f.instance(), a = f.install("manual", "17"), b = f.install("required", "21");
  value.config.type = f.Instance.TYPE_MINECRAFT_JAVA;
  await f.ui(value).handleUsingJava(a);
  value.checkJavaError("UnsupportedClassVersionError: server class file version 65.0");
  assert.equal(value.javaFixMajor, 21);
  const retries = []; value.setPreset("start", { async exec() { retries.push("start"); } });
  const attempts = [], originalFix = value.tryAutoJavaFix.bind(value);
  value.tryAutoJavaFix = major => { const attempt = originalFix(major); attempts.push(attempt); return attempt; };
  value.status(f.Instance.STATUS_RUNNING); value.stopped();
  assert.equal(attempts.length, 1); await attempts[0];
  assert.equal(value.config.java.id, b.fullname);
  assert.equal(f.storage.load("InstanceConfig", f.Config, value.instanceUuid).java.id, b.fullname);
  assert.deepEqual(retries, ["start"]);
  // Exercise the real stop guard; it suppresses a second automatic correction.
  value.checkJavaError("UnsupportedClassVersionError: server class file version 69.0");
  value.stopped(); assert.equal(attempts.length, 1);
  assert.deepEqual(retries, ["start"]);
});

test("optional real installed Java -version through selection, persistence and GeneralStartCommand", { timeout: 30000 }, async t => {
  const homes = realJavaHomes();
  if (homes.length === 0) { t.skip("No conventional local Java; set NEXCRAFT_TEST_JAVA_HOMES to opt in. No download."); return; }
  const f = await fixture(t), value = f.instance("java -version"), view = f.ui(value);
  f.actualVersions();
  for (const [index, home] of homes.slice(0, 2).entries()) {
    const info = f.install("real-local-" + index, undefined, home);
    await view.handleUsingJava(info); await f.start(value);
    const run = f.versionRuns.at(-1); await run.done;
    assert.equal(run.code, 0); assert.match(run.output, /version\s+"/i);
    assert.equal(run.exe, javaExe(home));
    t.diagnostic(`${run.exe}: ${run.output.trim().split(/\r?\n/)[0]}`);
  }
  t.diagnostic("Only -version executed; different installed paths/builds do not establish different Java major versions or Minecraft compatibility.");
});

function gate() {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const done = new Promise(resolve => { release = resolve; });
  return { entered, release, async wait() { enter(); await done; } };
}

test("missing, directory and inaccessible executables reject selection without changing the prior config", async t => {
  const f = await fixture(t), value = f.instance(), a = f.install("valid", "21");
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: a.fullname });
  const prior = JSON.stringify(value.config);
  for (const mode of ["missing", "directory", "denied"]) {
    const info = f.install(mode, "21"), exe = javaExe(info.path);
    if (mode !== "denied") fs.unlinkSync(exe);
    if (mode === "directory") fs.mkdirSync(exe);
    const access = f.io.java.access;
    if (mode === "denied") f.io.java.access = async (file, flags) => {
      if (file === exe) throw new Error("EACCES fixture");
      return access(file, flags);
    };
    await assert.rejects(f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: info.fullname }), /TXT_CODE_java_selection.executableUnavailable/);
    f.io.java.access = access;
    assert.equal(JSON.stringify(value.config), prior);
    assert.equal(f.storage.load("InstanceConfig", f.Config, value.instanceUuid).java.id, a.fullname);
  }
  if (process.platform !== "win32") {
    fs.chmodSync(javaExe(a.path), 0o644);
    await assert.rejects(f.start(value), /TXT_CODE_java_selection.executableUnavailable/);
  }
  assert.equal(f.launches.length, 0);
});

test("launch revalidates readiness and executable type/access after selection", async t => {
  const f = await fixture(t), value = f.instance(), info = f.install("runtime", "21");
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: info.fullname });
  f.java.getJava(info.fullname).info.downloading = true;
  await assert.rejects(f.start(value), /TXT_CODE_45d02bb7/);
  f.java.getJava(info.fullname).info.downloading = false;
  const access = f.io.java.access;
  f.io.java.access = async () => { throw new Error("EACCES fixture"); };
  await assert.rejects(f.start(value), /TXT_CODE_java_selection.executableUnavailable/);
  f.io.java.access = access;
  fs.unlinkSync(javaExe(info.path)); fs.mkdirSync(javaExe(info.path));
  await assert.rejects(f.start(value), /TXT_CODE_java_selection.executableUnavailable/);
  assert.equal(f.launches.length, 0);
});

test("an unloaded saved instance protects its runtime, while an unreferenced runtime can be deleted", async t => {
  const f = await fixture(t), used = f.install("used", "21"), free = f.install("free", "17");
  const saved = new f.Config(); saved.java.id = used.fullname;
  f.storage.store("InstanceConfig", "unloaded-instance", saved);
  await assert.rejects(f.java.removeJava(used.fullname), /unloaded-instance/);
  assert.equal(await f.java.removeJava(free.fullname), true);
  assert.equal(f.java.exists(free.fullname), false);
  assert.equal(fs.existsSync(path.join(f.java.getJavaDataDir(), free.fullname)), false);
  assert.equal(fs.existsSync(javaExe(free.path)), true, "Removing an external catalog entry preserves its installed home");
});

test("selection holding validation serializes deletion until the saved reference is published", async t => {
  const f = await fixture(t), value = f.instance(), info = f.install("runtime", "21"), paused = gate();
  const stat = f.io.java.stat;
  f.io.java.stat = async file => { if (file === javaExe(info.path)) await paused.wait(); return stat(file); };
  const selection = f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: info.fullname });
  await paused.entered;
  let settled = false;
  const deletion = f.java.removeJava(info.fullname).finally(() => { settled = true; });
  const denied = assert.rejects(deletion, /TXT_CODE_ea8ea5d1/);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
  paused.release(); await selection; await denied;
  assert.equal(f.storage.load("InstanceConfig", f.Config, value.instanceUuid).java.id, info.fullname);
});

test("deletion in progress serializes selection, which then rejects without saving a dangling ID", async t => {
  const f = await fixture(t), value = f.instance(), info = f.install("runtime", "21"), paused = gate();
  const remove = f.io.java.remove;
  f.io.java.remove = async file => { await paused.wait(); return remove(file); };
  const deletion = f.java.removeJava(info.fullname); await paused.entered;
  let settled = false;
  const selection = f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: info.fullname }).finally(() => { settled = true; });
  const denied = assert.rejects(selection, /TXT_CODE_77ce8542/);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
  paused.release(); await deletion; await denied;
  assert.equal(value.config.java.id, "");
  assert.equal(f.storage.load("InstanceConfig", f.Config, value.instanceUuid), null);
});

test("A is reserved before spawn/open even when B is selected during launch", async t => {
  const f = await fixture(t), value = f.instance(), a = f.install("a", "17"), b = f.install("b", "21"), paused = gate();
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: a.fullname });
  f.pauseBeforeSpawn(() => paused.wait());
  const launch = f.start(value); await paused.entered;
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: b.fullname });
  await assert.rejects(f.java.removeJava(a.fullname), /TXT_CODE_ea8ea5d1/);
  assert.deepEqual(f.java.getJava(a.fullname).usingInstances, [value.instanceUuid]);
  assert.deepEqual(f.java.getJava(b.fullname).usingInstances, []);
  paused.release(); await launch;
  assert.equal(f.launches.at(-1).exe, javaExe(a.path));
  value.stopped();
  assert.deepEqual(f.java.getJava(a.fullname).usingInstances, []);
  await f.java.removeJava(a.fullname);
});

test("spawn ENOENT after validation follows the real start failure path and releases launched A while B is pending", async t => {
  const f = await fixture(t), value = f.instance(), a = f.install("a", "17"), b = f.install("b", "21"), paused = gate();
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: a.fullname });
  f.pauseBeforeSpawn(() => paused.wait()); f.missingExecutable();
  const launch = f.execStart(value);
  const failed = assert.rejects(launch, /TXT_CODE_general_start.startErr.*ENOENT/);
  await paused.entered;
  fs.unlinkSync(javaExe(a.path));
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: b.fullname });
  paused.release(); await failed;
  assert.equal(value.status(), f.Instance.STATUS_STOP);
  assert.equal(value.process, undefined); assert.equal(value.lock, false);
  assert.deepEqual(f.java.getJava(a.fullname).usingInstances, []);
  assert.deepEqual(f.java.getJava(b.fullname).usingInstances, []);
  await f.java.removeJava(a.fullname);
  assert.equal(value.config.java.id, b.fullname);
});

test("partial candidate write failure and definite rename failure preserve memory, launcher and saved config", async t => {
  const f = await fixture(t), value = f.instance('java  -jar "server files/server.jar"'), a = f.install("a", "17"), b = f.install("b", "21");
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: a.fullname });
  const prior = JSON.stringify(value.config), saved = f.storage.readFile(`InstanceConfig/${value.instanceUuid}.json`);
  f.failSave("partial");
  await assert.rejects(f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: b.fullname }), /disk write denied/);
  f.failSave(false);
  assert.equal(JSON.stringify(value.config), prior);
  assert.equal(f.storage.readFile(`InstanceConfig/${value.instanceUuid}.json`), saved);
  f.io.storage.renameSync = () => { throw new Error("fixture rename denied"); };
  await assert.rejects(f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: b.fullname }), /rename denied/);
  assert.equal(JSON.stringify(value.config), prior);
  assert.equal(f.storage.readFile(`InstanceConfig/${value.instanceUuid}.json`), saved);
  assert.deepEqual(fs.readdirSync(path.join(f.dir, "data/JavaSelection")), []);
});

test("post-rename acknowledgement failure is accepted only after exact candidate readback", async t => {
  const f = await fixture(t), value = f.instance(), a = f.install("a", "17"), b = f.install("b", "21");
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: a.fullname });
  const rename = f.io.storage.renameSync;
  f.io.storage.renameSync = (from, to) => { rename(from, to); throw new Error("fixture lost rename acknowledgement"); };
  assert.equal(await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: b.fullname }), true);
  assert.equal(value.config.java.id, b.fullname);
  assert.equal(f.storage.load("InstanceConfig", f.Config, value.instanceUuid).java.id, b.fullname);
});

test("launcher replacement supports installed path syntax and preserves argv source including placeholder re-selection", () => {
  for (const first of ['java', 'java.exe', '"C:\\Program Files\\Java\\bin\\java.exe"', '"/opt/java home/bin/java"', './java', '{mcsm_java}']) {
    const suffix = '  -Xmx1G "-Dmessage=a b" -jar "server files/server.jar" nogui';
    assert.equal(parser.replaceJavaLauncher('  ' + first + suffix), '  {mcsm_java}' + suffix);
  }
  for (const script of ['bash start.sh', 'cmd.exe /c start.bat', './start.sh', 'python server.py']) {
    assert.throws(() => parser.replaceJavaLauncher(script), /TXT_CODE_java_selection.scriptLauncher/);
  }
});

test("legacy script config never reports the configured Java as a launched runtime", async t => {
  const f = await fixture(t), value = f.instance("bash start.sh"), info = f.install("legacy", "21");
  value.config.java.id = info.fullname;
  await f.start(value);
  assert.equal(f.launches[0].exe, "bash");
  assert.deepEqual(f.java.getJava(info.fullname).usingInstances, []);
});

test("installed home containing replacement syntax is passed literally to spawn", async t => {
  const f = await fixture(t), value = f.instance(), info = f.install("literal-$&-home", "21");
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: info.fullname });
  await f.start(value);
  assert.equal(f.launches[0].exe, javaExe(info.path));
});

test("automatic correction save failure preserves the original choice and does not retry", async t => {
  const f = await fixture(t), value = f.instance(), a = f.install("original", "17"), b = f.install("required", "21");
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: a.fullname });
  const before = JSON.stringify(value.config), retries = [];
  value.setPreset("start", { async exec() { retries.push("start"); } });
  f.failSave("partial"); await value.tryAutoJavaFix(21);
  assert.equal(JSON.stringify(value.config), before);
  assert.equal(f.storage.load("InstanceConfig", f.Config, value.instanceUuid).java.id, a.fullname);
  assert.deepEqual(retries, []);
  assert.ok(value.output.some(line => line[0] === "ERROR" && /disk write denied/.test(line[1])));
});


test("PTY rejects a vanished Java executable before spawning its helper", async t => {
  const f = await fixture(t), value = f.instance(), info = f.install("runtime", "21");
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: info.fullname });
  fs.unlinkSync(javaExe(info.path));
  await assert.rejects(f.execPtyStart(value), /TXT_CODE_java_selection.executableUnavailable/);
  assert.equal(f.ptyLaunches.length, 0);
  assert.equal(value.status(), f.Instance.STATUS_STOP);
  assert.equal(value.lock, false);
  assert.deepEqual(f.java.getJava(info.fullname).usingInstances, []);
});

test("PTY helper ENOENT is handled and releases launched A while B remains selected", async t => {
  const f = await fixture(t), value = f.instance(), a = f.install("a", "17"), b = f.install("b", "21"), paused = gate();
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: a.fullname });
  f.pauseBeforeSpawn(() => paused.wait());
  const launch = f.execPtyStart(value);
  const failed = assert.rejects(launch, /TXT_CODE_pty_start.instanceStartErr.*ENOENT/);
  await paused.entered;
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: b.fullname });
  paused.release(); await failed;
  assert.equal(f.ptyLaunches.length, 1);
  assert.deepEqual(f.ptyUnhandledErrors, []);
  assert.equal(value.status(), f.Instance.STATUS_STOP);
  assert.equal(value.process, undefined); assert.equal(value.lock, false);
  assert.deepEqual(f.java.getJava(a.fullname).usingInstances, []);
  assert.deepEqual(f.java.getJava(b.fullname).usingInstances, []);
  assert.equal(value.config.java.id, b.fullname);
  await f.java.removeJava(a.fullname);
});

test("non-Java GeneralStart preserves legacy quotes, backslashes and nested quote tokens", async t => {
  const cases = [
    [String.raw`"C:\Program Files\server\bedrock_server.exe"  "C:\server files\world"`,
      String.raw`C:\Program Files\server\bedrock_server.exe`, [String.raw`C:\server files\world`]],
    ['node "server files/app.js" "a {quotes}nested{quotes} value"',
      'node', ['server files/app.js', 'a "nested" value']],
    [String.raw`node app.js "C:\server files\" --title="two words"`,
      'node', ['app.js', 'C:\\server files\\', '--title="two words"']],
    ['bash -c "echo {quotes}two words{quotes}"', 'bash', ['-c', 'echo "two words"']]
  ];
  const f = await fixture(t);
  for (const [command, exe, args] of cases) {
    const value = f.instance(command);
    value.config.java.id = "stale-java-id-on-non-java-instance";
    await f.start(value);
    assert.equal(f.launches.at(-1).exe, exe);
    assert.deepEqual(f.launches.at(-1).args, args);
  }
});


test("an active installation rejects deletion and still cleans its own failed download", async t => {
  const f = await fixture(t), info = new javaTypes.JavaInfo("pending-install", Date.now(), "21"), paused = gate();
  f.storage.store("InstanceConfig", "unrelated-broken", {});
  fs.writeFileSync(path.join(f.dir, "data/InstanceConfig/unrelated-broken.json"), "{malformed config");
  f.java.getJavaDownloadUrl = async () => { await paused.wait(); throw new Error("fixture install failed before download"); };
  const install = f.java.downloadAndInstall(info);
  const failed = assert.rejects(install, /fixture install failed before download/);
  await paused.entered;
  try {
    await assert.rejects(f.java.removeJava(info.fullname), /TXT_CODE_887fee99/);
    assert.equal(f.java.exists(info.fullname), true);
  } finally {
    paused.release(); await failed;
  }
  assert.equal(f.java.exists(info.fullname), false);
  assert.equal(fs.existsSync(path.join(f.java.getJavaDataDir(), info.fullname)), false);
});

test("saved-reference scanning ignores Java staging files and fails closed on malformed saved config", async t => {
  const f = await fixture(t), free = f.install("free", "21"), guarded = f.install("guarded", "17");
  fs.mkdirSync(path.join(f.dir, "data/JavaSelection"), { recursive: true });
  fs.writeFileSync(path.join(f.dir, "data/JavaSelection/unfinished.json"), "{partial staging file");
  await f.java.removeJava(free.fullname);
  f.storage.store("InstanceConfig", "broken", {});
  fs.writeFileSync(path.join(f.dir, "data/InstanceConfig/broken.json"), "{malformed config");
  await assert.rejects(f.java.removeJava(guarded.fullname), SyntaxError);
  assert.equal(f.java.exists(guarded.fullname), true);
});

test("parse failure releases reserved A after B is selected without spawning", async t => {
  const f = await fixture(t), value = f.instance(), a = f.install("a", "17"), b = f.install("b", "21"), paused = gate();
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: a.fullname });
  const parse = value.parseTextParams.bind(value);
  value.parseTextParams = async (...args) => { const command = await parse(...args); await paused.wait(); return command + ' "unterminated'; };
  const launch = f.execStart(value);
  const failed = assert.rejects(launch, /TXT_CODE_command.quotes/);
  await paused.entered;
  assert.deepEqual(f.java.getJava(a.fullname).usingInstances, [value.instanceUuid]);
  await f.rpc("java_manager/using", { instanceId: value.instanceUuid, id: b.fullname });
  paused.release(); await failed;
  assert.equal(f.launches.length, 0);
  assert.equal(value.config.java.id, b.fullname);
  assert.equal(value.status(), f.Instance.STATUS_STOP); assert.equal(value.lock, false);
  assert.deepEqual(f.java.getJava(a.fullname).usingInstances, []);
  assert.deepEqual(f.java.getJava(b.fullname).usingInstances, []);
  await f.java.removeJava(a.fullname);
});


test("failed final install metadata save cannot publish a ready runtime or block own cleanup", async t => {
  const f = await fixture(t), info = new javaTypes.JavaInfo("metadata-failure", Date.now(), "21");
  // Exercise final metadata failure without a download or archive/executable I/O.
  f.io.download.downloadFromUrl = async () => {};
  f.java.updateJavaInfo = () => { assert.equal(info.downloading, false); throw new Error("fixture metadata save failed"); };
  await assert.rejects(f.java.downloadAndInstall(info, "https://example.invalid/runtime.fixture"), /fixture metadata save failed/);
  assert.equal(info.downloading, true);
  assert.equal(f.java.exists(info.fullname), false);
  assert.equal(fs.existsSync(path.join(f.java.getJavaDataDir(), info.fullname)), false);
});
