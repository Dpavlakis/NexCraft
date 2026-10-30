"use strict";

// Load the actual sampler and response handlers, isolating unrelated daemon IO.
// The Linux case measures a real child/grandchild tree with the installed pidusage.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const root = path.resolve(__dirname, "../..");
const dep = createRequire(path.join(root, "daemon/package.json"));
const ts = dep("typescript");
const realFs = dep("fs-extra");
const realPidusage = dep("pidusage");
const temporary = [];
after(() => {
  realPidusage.clear();
  for (const directory of temporary) {
    assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(directory).startsWith("nexcraft-live-memory-"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
function deferred() {
  let resolve;
  const promise = new Promise((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}
function source(relative, dependencies, globals = {}) {
  const filename = path.join(root, "daemon/src", relative + ".ts");
  const js = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(
    "(function(require,module,exports,setInterval,setTimeout,process,Date){" + js + "\n})",
    { filename }
  )(
    dependencies,
    module,
    module.exports,
    globals.setInterval || setInterval,
    globals.setTimeout || setTimeout,
    globals.process || process,
    globals.Date || Date
  );
  return module.exports;
}
const Instance = source("entity/instance/instance", (name) => {
  if (name === "events") return require("node:events");
  if (name === "i18next") return { t: (key) => key };
  if (name === "../../i18n") return { $t: (key) => key };
  // All remaining imports are used inside unrelated lifecycle operations.
  return {};
}).default;

function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nexcraft-live-memory-"));
  temporary.push(directory);
  const metricDirectory = path.join(directory, "data/metrics");
  fs.mkdirSync(metricDirectory, { recursive: true });
  if (options.history)
    fs.writeFileSync(path.join(metricDirectory, "server.json"), JSON.stringify(options.history));
  let now = 1_000_000;
  const intervals = [],
    waits = [],
    calls = [];
  const instance = Object.assign(Object.create(Instance.prototype), {
    instanceUuid: "server",
    instanceStatus: Instance.STATUS_RUNNING,
    startCount: 1,
    startTimestamp: 1000,
    process: { pid: options.pid || 123456789 },
    config: {
      processType: "general",
      nickname: "Local RAM fixture",
      tag: [],
      type: "minecraft/java",
      ...options.config
    },
    info: { mcPingOnline: true, currentPlayers: 0, maxPlayers: 20, ...options.info },
    forceExec: async () => ({})
  });
  const instances = new Map([[instance.instanceUuid, instance]]);
  const subsystem = {
    instances,
    getInstance: (uuid) => instances.get(uuid),
    getInstances: () => [...instances.values()],
    isGlobalInstance: () => false,
    getQueryMapWrapper: () => ({
      select: (predicate) => [...instances.values()].filter(predicate),
      page: (data, page, pageSize) => ({ data, page, pageSize, maxPage: 1 })
    })
  };
  const procFs = {
    ...realFs,
    readdirSync(directory, ...args) {
      if (options.noProc && directory === "/proc") throw Error("No proc in controlled boundary");
      return realFs.readdirSync(directory, ...args);
    },
    readFileSync(filename, ...args) {
      if (options.procStart && filename === `/proc/${instance.process?.pid}/stat`) {
        const fields = ["S", "1", ...Array(17).fill("0"), String(options.procStart())];
        return `${instance.process.pid} (fixture) ${fields.join(" ")}`;
      }
      if (options.noProc && filename.startsWith("/proc/"))
        throw Error("No proc in controlled boundary");
      return realFs.readFileSync(filename, ...args);
    }
  };
  const clock = class extends Date {
    static now() {
      return now;
    }
  };
  const metrics = source(
    "service/metrics_service",
    (name) => {
      if (name === "fs-extra") return procFs;
      if (name === "os") return os;
      if (name === "path") return path;
      if (name === "pidusage")
        return async (pid) => {
          const entry = { pid };
          calls.push(entry);
          entry.result = await (options.measure
            ? options.measure(pid, calls.length)
            : realPidusage(pid));
          return entry.result;
        };
      if (name === "./system_instance") return subsystem;
      if (name === "../entity/instance/instance") return Instance;
      throw Error("Unexpected sampler dependency " + name);
    },
    {
      Date: clock,
      process: { cwd: () => directory },
      setInterval(callback, ms) {
        intervals.push({ callback, ms });
        return intervals.length;
      },
      setTimeout(callback, ms) {
        waits.push(ms);
        if (options.realWait) return setTimeout(callback, ms);
        if (options.wait) options.wait(callback);
        else queueMicrotask(callback);
        return 0;
      }
    }
  );
  const service = metrics.default;
  function router() {
    const handlers = new Map();
    const protocol = {
      response: (ctx, data) => {
        ctx.data = data;
      },
      msg: (ctx, _event, data) => {
        ctx.data = data;
      },
      error: (_ctx, _event, data) => {
        throw Error(JSON.stringify(data));
      }
    };
    source("routers/Instance_router", (name) => {
      if (name === "../service/router")
        return { routerApp: { use() {}, on: (event, handler) => handlers.set(event, handler) } };
      if (name === "../entity/instance/instance") return Instance;
      if (name === "../service/system_instance") return subsystem;
      if (name === "../service/metrics_service") return metrics;
      if (name === "../service/protocol") return protocol;
      if (name === "../service/game_endpoint")
        return {
          resolveGameEndpoint: () => ({ port: null, protocol: "tcp", source: "unavailable" })
        };
      if (name === "mcsmanager-common")
        return { arrayUnique: (values) => [...new Set(values)], toNumber: Number };
      if (name === "../entity/commands/process_info") return class {};
      return {};
    });
    return async (event) => {
      const ctx = {};
      await handlers.get(event)(ctx, {
        page: 1,
        pageSize: 20,
        condition: { tag: [] },
        instanceUuid: "server",
        instanceUuids: ["server"]
      });
      return event === "instance/select"
        ? ctx.data.data[0]
        : event === "instance/detail"
        ? ctx.data
        : ctx.data[0];
    };
  }
  return {
    instance,
    instances,
    service,
    calls,
    intervals,
    waits,
    router,
    ttl: metrics.LIVE_MEMORY_MAX_AGE_MS,
    advance: (ms) => {
      now += ms;
    },
    sample: () => intervals[0].callback(),
    info: () => service.getLiveInfo(instance)
  };
}

test(
  "real process-tree RSS reaches every existing response without extra sampling or history reads",
  { skip: process.platform !== "linux", timeout: 20000 },
  async (t) => {
    const leafCode =
      "global.ram=Buffer.alloc(64*1024*1024,1);process.send({ready:true});setInterval(()=>{},1000)";
    const wrapperCode = `const {spawn}=require('node:child_process');global.ram=Buffer.alloc(16*1024*1024,1);const child=spawn(process.execPath,['-e',${JSON.stringify(
      leafCode
    )}],{stdio:['ignore','ignore','ignore','ipc']});child.once('message',()=>process.send({pid:child.pid}));process.on('message',()=>child.kill());setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ["-e", wrapperCode], {
      stdio: ["ignore", "ignore", "pipe", "ipc"]
    });
    let descendant;
    try {
      const [ready] = await once(child, "message");
      descendant = ready.pid;
      const f = fixture({ pid: child.pid, realWait: true });
      assert.equal(f.info().memoryUsage, undefined, "unmeasured running memory is unknown");
      await f.sample();
      const final = f.calls.slice(f.calls.length / 2);
      assert.ok(final.some((entry) => entry.pid === child.pid));
      assert.ok(
        final.some((entry) => entry.pid === descendant),
        "real descendant must be measured"
      );
      const bytes = final.reduce((sum, entry) => sum + entry.result.memory, 0);
      assert.ok(bytes >= 64 * 1024 * 1024);
      assert.ok(
        bytes > Math.max(...final.map((entry) => entry.result.memory)),
        "RSS includes the wrapper and child"
      );
      assert.equal(f.info().memoryUsage, bytes);
      assert.equal(f.info().memoryLimit, undefined);
      assert.deepEqual(
        f.intervals.map((timer) => timer.ms),
        [60000, 60000],
        "existing sample and persistence timers only"
      );
      assert.deepEqual(f.waits, [1000]);
      assert.equal(f.service.getMetrics("server").at(-1).memMB, Math.round(bytes / 1024 / 1024));
      const reads = f.calls.length;
      f.service.getMetrics = () => {
        throw Error("Response must not fetch history");
      };
      const response = f.router();
      for (let repeat = 0; repeat < 3; repeat++) {
        for (const event of [
          "instance/select",
          "instance/detail",
          "instance/section",
          "instance/overview"
        ]) {
          const result = await response(event);
          assert.equal(result.info.memoryUsage, bytes, event);
          assert.equal(result.info.currentPlayers, 0);
          assert.equal(result.info.maxPlayers, 20);
        }
      }
      assert.equal(f.calls.length, reads, "reading cards never calls pidusage");
      t.diagnostic(
        `Measured ${bytes} RSS bytes across real PIDs ${final
          .map((entry) => entry.pid)
          .join(", ")}; ${reads} existing sampler reads`
      );
      // Exercise actual OS read failure too, before the lifecycle status catches up.
      process.kill(descendant, "SIGKILL");
      descendant = undefined;
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      await f.sample();
      assert.equal(
        f.info().memoryUsage,
        undefined,
        "vanished real PID tree must clear the previous live bytes"
      );
    } finally {
      if (descendant) {
        try {
          process.kill(descendant, "SIGKILL");
        } catch {}
      }
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
    }
  }
);

test("measured zero is valid; unrounded bytes are preserved and no process limit is invented", async () => {
  let memory = 0;
  const f = fixture({
    noProc: true,
    measure: async () => ({ memory, cpu: 0 }),
    info: { memoryUsage: 999, memoryLimit: 123456, memoryUsagePercent: 50 }
  });
  await f.sample();
  assert.equal(f.info().memoryUsage, 0);
  assert.equal(f.info().memoryLimit, undefined);
  assert.equal(f.info().memoryUsagePercent, undefined);
  memory = 1234567;
  await f.sample();
  assert.equal(f.info().memoryUsage, 1234567);
  assert.equal(f.calls.length, 4);
});

test("all PID reads failing or invalid become unknown, never historical or raw zero", async () => {
  for (const value of [undefined, NaN, Infinity, -1]) {
    let failing = false;
    const f = fixture({
      noProc: true,
      history: [{ t: 1, memMB: 0, cpu: 0, players: 0 }],
      info: { memoryUsage: 0 },
      measure: async () => {
        if (!failing) return { memory: 456789, cpu: 0 };
        if (value === undefined) throw Error("process unavailable");
        return { memory: value, cpu: 0 };
      }
    });
    assert.equal(f.info().memoryUsage, undefined);
    await f.sample();
    assert.equal(f.info().memoryUsage, 456789);
    failing = true;
    await f.sample();
    assert.equal(f.info().memoryUsage, undefined);
    assert.equal(JSON.parse(JSON.stringify(f.info())).memoryUsage, undefined);
    assert.equal(
      f.service.getMetrics("server").at(-1).memMB,
      0,
      "legacy chart zero remains history only"
    );
  }
});

test("live cache expires and rejects changed PID, process, run counter and start timestamp", async () => {
  for (const change of [
    "expire",
    "pid",
    "process",
    "run",
    "timestamp",
    "stop",
    "stopping",
    "busy"
  ]) {
    const f = fixture({ noProc: true, measure: async () => ({ memory: 654321, cpu: 0 }) });
    await f.sample();
    assert.equal(f.info().memoryUsage, 654321);
    if (change === "expire") f.advance(f.ttl + 1);
    if (change === "pid") f.instance.process.pid++;
    if (change === "process") f.instance.process = { pid: f.instance.process.pid };
    if (change === "run") f.instance.startCount++;
    if (change === "timestamp") f.instance.startTimestamp++;
    if (change === "stop") f.instance.status(Instance.STATUS_STOP);
    if (change === "stopping") f.instance.status(Instance.STATUS_STOPPING);
    if (change === "busy") f.instance.status(Instance.STATUS_BUSY);
    assert.equal(f.info().memoryUsage, undefined, change);
    assert.equal(f.calls.length, 2, "cache validation performs no measurements");
  }
});

test("pending old samples cannot repopulate stopped, replaced, deleted or restarted instances", async () => {
  for (const change of ["stop", "pid", "process", "run", "timestamp", "delete", "replace"]) {
    const waiting = deferred(),
      entered = deferred();
    const f = fixture({
      noProc: true,
      measure: async () => ({ memory: 123, cpu: 0 }),
      wait: (callback) => {
        entered.resolve();
        waiting.promise.then(callback);
      }
    });
    const pending = f.sample();
    await entered.promise;
    if (change === "stop") {
      f.instance.status(Instance.STATUS_STOP);
      f.instance.process = undefined;
      f.instance.resetInstanceRuntimeInfo();
    }
    if (change === "pid") f.instance.process.pid++;
    if (change === "process") f.instance.process = { pid: f.instance.process.pid };
    if (change === "run") f.instance.startCount++;
    if (change === "timestamp") f.instance.startTimestamp++;
    if (change === "delete") f.instances.delete("server");
    if (change === "replace")
      f.instances.set("server", Object.assign(Object.create(Instance.prototype), f.instance));
    waiting.resolve();
    await pending;
    assert.equal(f.info().memoryUsage, undefined, change);
    assert.equal(
      f.service.getMetrics("server").length,
      0,
      "stale completion cannot append history either"
    );
  }
});

test("a late old completion cannot erase a replacement run's real sampler result", async () => {
  const callbacks = [],
    entered = deferred();
  const f = fixture({
    noProc: true,
    measure: async () => ({ memory: f.instance.startCount === 1 ? 111 : 222, cpu: 0 }),
    wait: (callback) => {
      callbacks.push(callback);
      entered.resolve();
    }
  });
  const old = f.sample();
  await entered.promise;
  f.instance.status(Instance.STATUS_STOP);
  f.instance.resetInstanceRuntimeInfo();
  f.instance.process = { pid: 123456790 };
  f.instance.startCount++;
  f.instance.startTimestamp++;
  f.instance.status(Instance.STATUS_STARTING);
  assert.equal(f.info().memoryUsage, undefined);
  const fresh = f.sample();
  while (callbacks.length < 2) await new Promise((resolve) => setImmediate(resolve));
  callbacks[1]();
  await fresh;
  f.instance.status(Instance.STATUS_RUNNING);
  assert.equal(f.info().memoryUsage, 222);
  callbacks[0]();
  await old;
  assert.equal(f.info().memoryUsage, 222);
  assert.equal(f.service.getMetrics("server").length, 1);
});

test("Linux PID start-tick changes reject recycled-PID measurements", async () => {
  let ticks = 100;
  const f = fixture({
    noProc: true,
    procStart: () => ticks,
    measure: async (_pid, count) => {
      if (count === 2) ticks++;
      return { memory: 700, cpu: 0 };
    }
  });
  await f.sample();
  assert.equal(f.calls.length, 2);
  assert.equal(f.info().memoryUsage, undefined);
});

test("overlapping cadence ticks share the pending sampler instead of adding PID reads", async () => {
  const entered = deferred(),
    release = deferred();
  const f = fixture({
    noProc: true,
    measure: async () => ({ memory: 300, cpu: 0 }),
    wait: (callback) => {
      entered.resolve();
      release.promise.then(callback);
    }
  });
  const first = f.sample();
  await entered.promise;
  await f.sample();
  assert.equal(f.calls.length, 1);
  release.resolve();
  await first;
  assert.equal(f.calls.length, 2);
  assert.equal(f.info().memoryUsage, 300);
});

test("native Docker bytes and real limit stay supported without host-PID sampling", async () => {
  const f = fixture({ config: { processType: "docker" } });
  let usage = 987654321;
  const DockerStatsTask = source("entity/commands/task/docker_stats", (name) => {
    if (name === "../../instance/instance") return Instance;
    if (name === "../../../service/docker_service")
      return {
        DefaultDocker: class {
          getContainer() {
            return {
              stats: async () => ({
                memory_stats: { usage, stats: { cache: 0 }, limit: 2 ** 30 },
                cpu_stats: {},
                precpu_stats: {},
                networks: {}
              })
            };
          }
        }
      };
    throw Error("Unexpected Docker boundary " + name);
  }).default;
  const docker = new DockerStatsTask();
  await docker.updateStats("native-container-id", f.instance);
  f.instance.process = { pid: "native-container-id" };
  await f.sample();
  assert.equal(f.info().memoryUsage, 987654321);
  assert.equal(f.info().memoryLimit, 2 ** 30);
  assert.equal(f.calls.length, 0);
  usage = 0;
  await docker.updateStats("native-container-id", f.instance);
  assert.equal(f.info().memoryUsage, 0);
  f.instance.info.memoryUsage = NaN;
  assert.equal(f.info().memoryUsage, undefined);
  f.instance.info.memoryUsage = 10;
  f.instance.status(Instance.STATUS_STOP);
  assert.equal(f.info().memoryUsage, undefined);
  f.instance.resetInstanceRuntimeInfo();
  f.instance.startCount++;
  f.instance.startTimestamp++;
  f.instance.process = { pid: "replacement-container" };
  f.instance.status(Instance.STATUS_RUNNING);
  assert.equal(f.info().memoryUsage, undefined);
  assert.equal(f.calls.length, 0);
});
