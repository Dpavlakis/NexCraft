"use strict";

// Exercise the actual task/base/lock sources with inert IO, server, and download
// boundaries. No live game process or backup directory is ever touched.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { EventEmitter, once } = require("node:events");
const { Writable } = require("node:stream");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const dep = createRequire(path.join(root, "daemon/package.json"));
const ts = dep("typescript");
const base = path.join(root, "daemon/src");

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 50 && !predicate(); i++) await turn();
  assert.ok(predicate(), "fixture did not reach the expected lifecycle boundary");
}

function fixture(options = {}) {
  const h = {
    calls: [],
    logs: [],
    streams: [],
    downloads: [],
    now: 2000,
    gates: options.gates || {},
    saved: false,
    config: {
      compress: false,
      exclusions: ["excluded/**"],
      maxBackups: 3,
      ...options.config
    }
  };
  const mocks = new Map(),
    cache = new Map();
  const mock = (name, value) => mocks.set(path.join(base, name + ".ts"), value);
  const Instance = { STATUS_STOP: 0, STATUS_RUNNING: 1, STATUS_BUSY: 2 };
  let state = options.running ? Instance.STATUS_RUNNING : Instance.STATUS_STOP;
  const cwd = path.join(os.tmpdir(), "inert-nexcraft-progress", "server");
  h.instance = {
    instanceUuid: "progress-fixture",
    config: {
      packInfo: options.noPack
        ? undefined
        : {
            source: options.source || "curseforge",
            mcVersion: "1.21",
            loader: "fabric",
            loaderVersion: "0.16",
            installedAt: 1
          }
    },
    absoluteCwdPath: () => cwd,
    status(value) {
      if (value !== undefined) state = value;
      return state;
    },
    println(level, message) {
      h.logs.push({ level, message });
    },
    async execPreset(command, argument) {
      h.calls.push([command, argument]);
      await h.gates[command]?.promise;
      if (command === "stop") state = Instance.STATUS_STOP;
      if (command === "start") state = Instance.STATUS_RUNNING;
    },
    parameters(value, save) {
      h.calls.push(["parameters", value, save]);
      if (options.parametersError) throw options.parametersError;
      h.saved = true;
    }
  };
  h.manager = {
    getConfig: () => h.config,
    applyRetention(...args) {
      h.calls.push(["retention", ...args]);
      if (options.retentionError) throw options.retentionError;
    },
    startBackupTask() {
      h.childBackup = new h.BackupTask(h.instance);
      h.childBackup.on("error", () => {});
      h.childBackup.on("started", () => {
        // Child completion must not leak operation completion to its parent.
        h.afterChild = h.task.toObject();
      });
      void h.childBackup.start().catch(() => {});
      return h.childBackup;
    }
  };
  h.downloadManager = {
    tasks: h.downloads,
    downloadFromUrl(url, target) {
      h.calls.push(["download", url, target]);
      const gate = deferred();
      const record = {
        id: "fixture-download",
        path: target,
        total: 0,
        current: 0,
        status: 0,
        controller: new AbortController()
      };
      h.downloads.push(record);
      h.downloadGate = gate;
      return gate.promise;
    }
  };
  const fakeFs = {
    createWriteStream(target) {
      h.calls.push(["output", target]);
      const stream = options.createOutput ? options.createOutput() : new EventEmitter();
      if (!options.createOutput) {
        stream.closed = false;
        stream.destroy = () => {
          h.calls.push(["output-destroy"]);
          if (options.manualShutdown) return;
          queueMicrotask(() => h.closeOutput(stream));
        };
      }
      h.output = stream;
      return stream;
    },
    ensureDirSync(dir) {
      h.calls.push(["ensureDirSync", dir]);
    },
    existsSync: () => true,
    removeSync(file) {
      h.calls.push(["removeSync", file]);
    },
    async remove(file) {
      h.calls.push(["remove", file]);
      if (h.saved) {
        await h.gates.cleanup?.promise;
        if (options.cleanupError) throw options.cleanupError;
      }
    },
    async ensureDir(dir) {
      h.calls.push(["ensureDir", dir]);
    },
    async copy(src, dest, config) {
      h.calls.push(["copy", src, dest]);
      assert.equal(config.overwrite, true);
      assert.equal(config.filter(path.join(src, "world/level.dat")), false);
      assert.equal(config.filter(path.join(src, "mods/server.jar")), true);
      await h.gates.copy?.promise;
    }
  };
  const external = {
    "fs-extra": fakeFs,
    uuid: { v4: () => "fixture-uuid" },
    archiver: (...args) => {
      h.calls.push(["archiver", ...args]);
      const stream = new EventEmitter(),
        finalize = deferred();
      stream.destroyed = false;
      stream.closed = false;
      stream.readableEnded = false;
      stream.pipe = () => h.calls.push(["pipe"]);
      stream.unpipe = () => h.calls.push(["unpipe"]);
      stream.glob = (glob, config) => h.calls.push(["glob", glob, config]);
      stream.finalize = () => finalize.promise;
      stream.abort = () => h.calls.push(["abort"]);
      stream.resume = () => {
        if (!options.manualShutdown && !stream.readableEnded)
          queueMicrotask(() => h.endArchive(stream));
      };
      stream.destroy = () => {
        stream.destroyed = true;
        h.calls.push(["archive-destroy"]);
        if (!options.manualShutdown) queueMicrotask(() => h.closeArchive(stream));
      };
      h.archive = stream;
      h.finalize = finalize;
      h.streams.push(stream);
      return stream;
    }
  };
  mock("entity/instance/instance", Instance);
  mock("i18n", { $t: (key, args) => key + (args ? ":" + JSON.stringify(args) : "") });
  mock("utils/sleep", {
    sleep: async () => {
      throw Error("unexpected server wait");
    }
  });
  mock("service/log", { info() {}, warn() {}, error() {} });
  mock("service/backup_service", {
    __esModule: true,
    default: h.manager,
    backupDir: () => path.join(os.tmpdir(), "inert-nexcraft-progress", "backups")
  });
  mock("service/download_manager", {
    __esModule: true,
    default: h.downloadManager,
    DOWNLOAD_STATUS: { DOWNLOADING: 0, COMPLETED: 1, ERROR: 2 }
  });
  mock("service/modloader_bootstrap", {
    ModloaderBootstrap: class {
      async run() {
        h.calls.push(["bootstrap"]);
        await h.gates.bootstrap?.promise;
        return { startCommand: "inert-command" };
      }
      cancel() {
        h.calls.push(["bootstrap-cancel"]);
      }
    }
  });
  mock("service/modpack_files", {
    async extractZipOverwrite() {
      h.calls.push(["extract"]);
      await h.gates.extract?.promise;
    },
    async maybeFlatten() {
      h.calls.push(["flatten"]);
    },
    async parseMrpackIndex() {
      return { dependencies: { minecraft: "1.21" } };
    },
    resolveLoader: () => ({ loader: "fabric", loaderVersion: "0.16" }),
    async downloadMrpackFiles(_index, _cwd, callback) {
      h.mrpackProgress = callback;
      h.calls.push(["mrpack"]);
      await h.gates.mrpack?.promise;
    },
    async extractMrpackOverrides() {
      h.calls.push(["overrides"]);
    },
    async clearReplaceableArtifacts() {
      h.calls.push(["clear"]);
      if (options.applyError) throw options.applyError;
    },
    makeShouldPreserve: () => (relative) => relative.startsWith("world"),
    async removeKnownClientMods() {
      return [];
    }
  });
  class FixtureDate extends Date {
    static now() {
      return h.now;
    }
  }
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
    vm.runInThisContext("(function(require,module,exports,Date){" + code + "\n})", { filename })(
      (name) => {
        if (Object.hasOwn(external, name)) return external[name];
        if (name.startsWith(".")) {
          const target = path.resolve(path.dirname(filename), name);
          return source(
            mocks.has(target + ".ts") || fs.existsSync(target + ".ts")
              ? target + ".ts"
              : path.join(target, "index.ts")
          );
        }
        return dep(name);
      },
      module,
      module.exports,
      FixtureDate
    );
    return module.exports;
  }
  const src = (name) => source(path.join(base, name + ".ts"));
  Object.assign(h, src("service/async_task_service/index"));
  Object.assign(h, src("service/async_task_service/backup_task"));
  Object.assign(h, src("service/async_task_service/modpack_update_task"));
  Object.assign(h, src("service/instance_operation_lock"));
  h.endArchive = (stream = h.archive) => {
    if (!stream.readableEnded) {
      stream.readableEnded = true;
      stream.emit("end");
    }
  };
  h.closeArchive = (stream = h.archive) => {
    if (!stream.closed) {
      stream.closed = true;
      stream.emit("close");
    }
  };
  h.closeOutput = (stream = h.output) => {
    if (!stream.closed) {
      stream.closed = true;
      stream.emit("close");
    }
  };
  h.emitProgress = (processedBytes, totalBytes, entries) =>
    h.archive.emit("progress", {
      entries: { processed: entries, total: entries },
      fs: { processedBytes, totalBytes }
    });
  h.finishArchive = () => {
    h.endArchive();
    h.finalize.resolve();
    h.closeOutput();
  };
  h.start = (kind = "backup") => {
    h.task =
      kind === "backup"
        ? new h.BackupTask(h.instance)
        : new h.ModpackUpdateTask(h.instance, {
            source: options.source || "curseforge",
            serverPackUrl: "https://fixture.invalid/server.zip",
            mrpackUrl: "https://fixture.invalid/pack.mrpack",
            packInfo: { versionId: "new" }
          });
    h.task.on("error", () => {});
    h.snapshotsAtStop = [];
    h.task.on("stopped", () => h.snapshotsAtStop.push(h.task.toObject()));
    void h.task.start().catch(() => {});
    h.outcome = h.task.wait().then(
      () => undefined,
      (error) => error
    );
    return h.task;
  };
  h.enterDownload = async () => {
    h.start("update");
    await until(() => !!h.archive);
    h.finishArchive();
    await until(() => h.downloads.length > 0);
  };
  h.finishDownload = () => {
    const record = h.downloads[0];
    record.current = record.total || record.current;
    record.status = 1;
    h.downloadGate.resolve();
  };
  return h;
}

function active(task, phase) {
  const value = task.toObject();
  assert.equal(value.status, 1);
  if (phase) assert.equal(value.progress.phase, phase);
  assert.equal(value.progress.completed, false);
  assert.ok(value.progress.percentage < 100);
  return value.progress;
}

test("backup discovery uses real activity, suppresses duplicate logs, and waits for final close", async () => {
  const h = fixture();
  h.start();
  h.emitProgress(10, 10, 1);
  assert.deepEqual(active(h.task, "archive"), {
    percentage: 0,
    processedBytes: 10,
    totalBytes: 0,
    entries: 1,
    phase: "archive",
    indeterminate: true,
    completed: false
  });
  h.now += 1000;
  h.emitProgress(10, 10, 1);
  h.now += 1000;
  h.emitProgress(10, 100, 1);
  assert.equal(
    h.logs.filter((x) => x.message.startsWith("TXT_CODE_backup.progressMeasured")).length,
    1
  );
  h.now += 1000;
  h.emitProgress(100, 100, 2);
  assert.equal(active(h.task).indeterminate, true);
  assert.equal(
    h.logs.filter((x) => x.message.startsWith("TXT_CODE_backup.progressMeasured")).length,
    2
  );
  assert.ok(h.logs.every((x) => !x.message.includes("percentage")));
  const glob = h.calls.find((x) => x[0] === "glob");
  assert.deepEqual(glob[2].ignore, ["excluded/**"]);
  assert.equal(glob[2].dot, true);

  h.endArchive();
  h.finalize.resolve();
  await turn();
  assert.equal(active(h.task, "finalization").totalBytes, 100);
  assert.throws(() => h.acquireInstanceOperation("progress-fixture"), /already running/);
  assert.ok(!h.calls.some((x) => x[0] === "retention"));
  h.closeOutput();
  assert.equal(await h.outcome, undefined);
  assert.equal(h.task.status(), 0);
  assert.equal(h.task.progress.percentage, 100);
  assert.equal(h.task.progress.completed, true);
  assert.equal(h.task.progress.phase, "done");
  assert.ok(h.snapshotsAtStop.every((s) => s.progress.completed === false));
  assert.ok(h.calls.some((x) => x[0] === "retention" && x[2] === 3));
  assert.equal(h.logs.filter((x) => x.message === "TXT_CODE_backup.success").length, 1);
  h.acquireInstanceOperation("progress-fixture")();
});

test("output close alone cannot complete backup before archive end and finalize resolve", async () => {
  const h = fixture();
  h.start();
  h.closeOutput();
  await turn();
  active(h.task, "archive");
  h.endArchive();
  await turn();
  active(h.task, "finalization");
  assert.ok(!h.calls.some((x) => x[0] === "retention"));
  h.finalize.resolve();
  assert.equal(await h.outcome, undefined);
  assert.equal(h.task.progress.completed, true);
});

test("backup finalization rejection after output close stays failed", async () => {
  const h = fixture();
  h.start();
  h.emitProgress(10, 10, 1);
  h.closeOutput();
  const failure = Error("late archive finalization");
  h.finalize.reject(failure);
  assert.equal(await h.outcome, failure);
  assert.equal(h.task.status(), -1);
  assert.equal(h.task.progress.completed, false);
  assert.equal(h.task.progress.phase, "failed");
  assert.ok(h.task.progress.percentage < 100);
  assert.ok(!h.calls.some((x) => x[0] === "retention"));
  assert.ok(h.calls.some((x) => x[0] === "removeSync"));
  assert.ok(!h.logs.some((x) => x.message === "TXT_CODE_backup.success"));
  h.acquireInstanceOperation("progress-fixture")();
});

test("backup failure keeps its lock and partial archive until source/output/archive shutdown", async () => {
  const h = fixture({ manualShutdown: true });
  h.start();
  const failure = Error("source read failed");
  h.archive.emit("error", failure);
  await turn();
  assert.throws(() => h.acquireInstanceOperation("progress-fixture"), /already running/);
  assert.ok(!h.calls.some((x) => x[0] === "removeSync"));
  h.closeOutput();
  await turn();
  assert.throws(() => h.acquireInstanceOperation("progress-fixture"), /already running/);
  h.endArchive();
  await turn();
  assert.ok(h.calls.some((x) => x[0] === "archive-destroy"));
  assert.ok(!h.calls.some((x) => x[0] === "removeSync"));
  h.closeArchive();
  assert.equal(await h.outcome, failure);
  assert.equal(h.task.progress.completed, false);
  assert.equal(h.task.progress.phase, "failed");
  h.acquireInstanceOperation("progress-fixture")();
});

test("backup remains incomplete throughout restart and post-command", async () => {
  const restart = deferred(),
    post = deferred();
  const h = fixture({
    running: true,
    config: { shutdown: true, preCommand: "save", postCommand: "saved" },
    gates: { start: restart }
  });
  // The command gate applies only to the post-command after archive creation.
  h.start();
  await until(() => !!h.archive);
  h.gates.command = post;
  h.finishArchive();
  await until(() => h.calls.some((x) => x[0] === "start"));
  active(h.task, "restart");
  assert.throws(() => h.acquireInstanceOperation("progress-fixture"), /already running/);
  restart.resolve();
  await until(() => h.calls.some((x) => x[0] === "command" && x[1] === "saved"));
  active(h.task);
  assert.ok(!h.logs.some((x) => x.message === "TXT_CODE_backup.success"));
  post.resolve();
  assert.equal(await h.outcome, undefined);
  assert.equal(h.task.progress.completed, true);
  assert.deepEqual(
    h.calls.filter((x) => ["command", "stop", "start"].includes(x[0])),
    [
      ["command", "save"],
      ["stop", undefined],
      ["start", undefined],
      ["command", "saved"]
    ]
  );
});

test("cancelled backup drains streams, removes partial output, and never claims success", async () => {
  const h = fixture();
  h.start();
  h.emitProgress(1, 1, 1);
  await h.task.stop();
  await h.outcome;
  assert.equal(h.task.status(), 0);
  assert.equal(h.task.progress.completed, false);
  assert.equal(h.task.progress.phase, "cancelled");
  assert.ok(h.task.progress.percentage < 100);
  assert.ok(h.calls.some((x) => x[0] === "removeSync"));
  assert.ok(!h.calls.some((x) => x[0] === "retention"));
  assert.ok(!h.logs.some((x) => x.message === "TXT_CODE_backup.success"));
  h.acquireInstanceOperation("progress-fixture")();
});

test("update forwards real child and download counts; full success waits for cleanup and restart", async () => {
  const stop = deferred(),
    copy = deferred(),
    bootstrap = deferred(),
    cleanup = deferred(),
    restart = deferred(),
    extract = deferred();
  const h = fixture({
    running: true,
    gates: { stop, copy, bootstrap, cleanup, start: restart, extract }
  });
  h.start("update");
  h.emitProgress(5, 5, 1);
  assert.deepEqual(active(h.task, "backup"), {
    percentage: 0,
    processedBytes: 5,
    totalBytes: 0,
    entries: 1,
    phase: "backup",
    indeterminate: true,
    completed: false
  });
  h.finishArchive();
  await until(() => h.calls.some((x) => x[0] === "stop"));
  assert.equal(h.childBackup.progress.completed, true);
  assert.equal(h.afterChild.progress.percentage, 0);
  assert.equal(h.afterChild.progress.completed, false);
  assert.equal(h.afterChild.progress.indeterminate, true);
  assert.equal(h.afterChild.progress.processedBytes, 5);
  active(h.task, "stop");
  stop.resolve();
  await until(() => h.downloads.length > 0);
  const record = h.downloads[0];
  record.current = 30;
  record.total = 100;
  assert.equal(active(h.task, "download").percentage, 30);
  assert.equal(h.task.toObject().downloadProgress.downloadedBytes, 30);
  record.current = 100;
  assert.equal(active(h.task).percentage, 99);
  h.finishDownload();
  await until(() => h.calls.some((x) => x[0] === "extract"));
  assert.equal(active(h.task, "download").indeterminate, true);
  extract.resolve();
  await until(() => h.calls.some((x) => x[0] === "copy"));
  assert.equal(active(h.task, "apply").indeterminate, true);
  copy.resolve();
  await until(() => h.calls.some((x) => x[0] === "bootstrap"));
  active(h.task, "bootstrap");
  bootstrap.resolve();
  await until(() => h.saved);
  active(h.task, "finalization");
  assert.equal(h.task.phase, "bootstrap"); // compatible legacy phase until success
  assert.ok(!h.calls.some((x) => x[0] === "start"));
  cleanup.resolve();
  await until(() => h.calls.some((x) => x[0] === "start"));
  active(h.task, "finalization");
  assert.ok(!h.logs.some((x) => x.message === "TXT_CODE_modpack.updateDone"));
  restart.resolve();
  assert.equal(await h.outcome, undefined);
  assert.equal(h.task.status(), 0);
  assert.equal(h.task.phase, "done");
  assert.equal(h.task.progress.completed, true);
  assert.equal(h.task.progress.percentage, 100);
  assert.ok(h.snapshotsAtStop.every((s) => !s.progress.completed));
  assert.equal(h.logs.filter((x) => x.message === "TXT_CODE_modpack.updateDone").length, 1);
});

test("unknown-length update download keeps real bytes and an indeterminate percentage", async () => {
  const extract = deferred(),
    h = fixture({ gates: { extract } });
  await h.enterDownload();
  h.downloads[0].current = 12345;
  const p = active(h.task, "download");
  assert.equal(p.processedBytes, 12345);
  assert.equal(p.totalBytes, 0);
  assert.equal(p.percentage, 0);
  assert.equal(p.indeterminate, true);
  h.finishDownload();
  extract.resolve();
  assert.equal(await h.outcome, undefined);
});

test("mrpack file discovery forwards real processed entries without inventing a byte total", async () => {
  const mrpack = deferred(),
    h = fixture({ source: "modrinth", gates: { mrpack } });
  await h.enterDownload();
  h.finishDownload();
  await until(() => !!h.mrpackProgress);
  h.mrpackProgress(7, 20);
  const p = active(h.task, "download");
  assert.equal(p.entries, 7);
  assert.equal(p.processedBytes, 0);
  assert.equal(p.totalBytes, 0);
  assert.equal(p.indeterminate, true);
  assert.equal(p.percentage, 0);
  h.mrpackProgress(20, 20);
  assert.equal(active(h.task).completed, false);
  mrpack.resolve();
  assert.equal(await h.outcome, undefined);
});

test("failed child backup aborts update without download, apply, restart, or success", async () => {
  const h = fixture({ running: true });
  h.start("update");
  const failure = Error("child backup failed");
  h.archive.emit("error", failure);
  assert.equal(await h.outcome, failure);
  assert.equal(h.task.status(), -1);
  assert.equal(h.task.progress.completed, false);
  assert.ok(h.task.progress.percentage < 100);
  assert.ok(!h.calls.some((x) => ["download", "clear", "start"].includes(x[0])));
  assert.ok(!h.logs.some((x) => x.message === "TXT_CODE_modpack.updateDone"));
});

for (const stage of ["download", "apply", "bootstrap", "finalization"]) {
  test("update " + stage + " failure never produces done/100 or restarts the server", async () => {
    const failure = Error(stage + " failure"),
      bootstrap = deferred();
    const h = fixture({
      running: true,
      applyError: stage === "apply" ? failure : undefined,
      parametersError: stage === "finalization" ? failure : undefined,
      gates: stage === "bootstrap" ? { bootstrap } : {}
    });
    await h.enterDownload();
    if (stage === "download") h.downloadGate.reject(failure);
    else h.finishDownload();
    if (stage === "bootstrap") {
      await until(() => h.calls.some((x) => x[0] === "bootstrap"));
      bootstrap.reject(failure);
    }
    assert.equal(await h.outcome, failure);
    assert.equal(h.task.status(), -1);
    assert.equal(h.task.progress.phase, "failed");
    assert.equal(h.task.progress.completed, false);
    assert.ok(h.task.progress.percentage < 100);
    assert.notEqual(h.task.phase, "done");
    assert.ok(!h.calls.some((x) => x[0] === "start"));
    assert.ok(!h.logs.some((x) => x.message === "TXT_CODE_modpack.updateDone"));
    assert.ok(h.logs.some((x) => x.message === "TXT_CODE_modpack.updateFailedStopped"));
  });
}

test("download manager cancellation that resolves normally is still a failed update", async () => {
  const h = fixture();
  await h.enterDownload();
  h.downloads[0].controller.abort();
  h.downloadGate.resolve();
  assert.match((await h.outcome).message, /updateCancelled/);
  assert.equal(h.task.status(), -1);
  assert.equal(h.task.progress.completed, false);
  assert.ok(!h.calls.some((x) => x[0] === "extract" || x[0] === "clear"));
});

test("cancelled update cannot resume apply or publish success after its download settles", async () => {
  const h = fixture({ running: true });
  await h.enterDownload();
  await h.task.stop();
  assert.equal(h.task.progress.phase, "cancelled");
  h.finishDownload();
  await h.outcome;
  assert.equal(h.task.status(), 0);
  assert.equal(h.task.progress.completed, false);
  assert.ok(h.task.progress.percentage < 100);
  assert.notEqual(h.task.phase, "done");
  assert.ok(!h.calls.some((x) => ["extract", "clear", "start"].includes(x[0])));
  assert.ok(!h.logs.some((x) => x.message === "TXT_CODE_modpack.updateDone"));
});

test("invalid update metadata reports failure through the real task lifecycle", async () => {
  const h = fixture({ noPack: true });
  h.start("update");
  assert.match((await h.outcome).message, /notModpack/);
  assert.equal(h.task.status(), -1);
  assert.equal(h.task.progress.completed, false);
  assert.equal(h.task.progress.phase, "failed");
  assert.equal(h.streams.length, 0);
});

test("archive close failure after finalized output still fails before retention or success", async () => {
  const h = fixture({ manualShutdown: true });
  h.start();
  h.emitProgress(5, 5, 1);
  h.finishArchive();
  await until(() => h.calls.some((x) => x[0] === "archive-destroy"));
  active(h.task, "finalization");
  assert.throws(() => h.acquireInstanceOperation("progress-fixture"), /already running/);
  const failure = Error("late archive close failure");
  h.archive.emit("error", failure);
  h.closeArchive();
  assert.equal(await h.outcome, failure);
  assert.equal(h.task.progress.completed, false);
  assert.ok(!h.calls.some((x) => x[0] === "retention"));
  assert.ok(!h.logs.some((x) => x.message === "TXT_CODE_backup.success"));
  h.acquireInstanceOperation("progress-fixture")();
});

test("manager list cleanup cannot discard a download's measured progress", async () => {
  const extract = deferred(),
    h = fixture({ gates: { extract } });
  await h.enterDownload();
  const record = h.downloads[0];
  record.current = 50;
  record.total = 100;
  h.downloads.splice(0);
  const p = active(h.task, "download");
  assert.equal(p.processedBytes, 50);
  assert.equal(p.totalBytes, 100);
  assert.equal(p.percentage, 50);
  record.current = 100;
  record.status = 1;
  h.downloadGate.resolve();
  extract.resolve();
  assert.equal(await h.outcome, undefined);
});

test("update cleanup failure remains failed and stopped without whole-operation success", async () => {
  const failure = Error("staging cleanup failed");
  const h = fixture({ running: true, cleanupError: failure });
  await h.enterDownload();
  h.finishDownload();
  assert.equal(await h.outcome, failure);
  assert.equal(h.task.status(), -1);
  assert.equal(h.task.progress.phase, "failed");
  assert.equal(h.task.progress.completed, false);
  assert.ok(h.task.progress.percentage < 100);
  assert.notEqual(h.task.phase, "done");
  assert.ok(!h.calls.some((x) => x[0] === "start"));
  assert.ok(!h.logs.some((x) => x.message === "TXT_CODE_modpack.updateDone"));
  assert.ok(h.calls.some((x) => x[0] === "remove" && x[1].endsWith(".mcsm_update_archive")));
});

async function settles(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("premature-close task did not settle within 1000ms")),
          1000
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function assertFailedClose(h, key) {
  assert.equal(h.task.status(), -1);
  assert.equal(h.task.progress.phase, "failed");
  assert.equal(h.task.progress.completed, false);
  assert.ok(h.task.progress.percentage < 100);
  assert.ok(h.logs.some((x) => x.level === "ERROR" && x.message === key));
  assert.ok(!h.calls.some((x) => x[0] === "retention"));
  assert.ok(h.calls.some((x) => x[0] === "removeSync"));
  assert.ok(!h.logs.some((x) => x.message === "TXT_CODE_backup.success"));
  h.acquireInstanceOperation("progress-fixture")();
}

for (const finalized of [false, true]) {
  test(
    "unexpected archive close without end fails and releases its lock (finalized=" +
      finalized +
      ")",
    { timeout: 2000 },
    async () => {
      const h = fixture();
      h.start();
      h.emitProgress(5, 5, 1);
      if (finalized) {
        h.finalize.resolve();
        await turn();
      }
      // No error, end, cancellation, or later finalize resolution will arrive.
      h.closeArchive();
      assert.match((await settles(h.outcome)).message, /TXT_CODE_backup.archiveClosedEarly/);
      assertFailedClose(h, "TXT_CODE_backup.archiveClosedEarly");
      assert.equal(h.output.closed, true);
    }
  );
}

const createWritableOutput = () =>
  new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });

for (const archiveReady of [false, true]) {
  test(
    "real unfinished output close fails even if archive is ready (" + archiveReady + ")",
    { timeout: 2000 },
    async () => {
      const h = fixture({ createOutput: createWritableOutput });
      h.start();
      if (archiveReady) {
        h.endArchive();
        h.finalize.resolve();
        await turn();
      }
      assert.equal(h.output.writableFinished, false);
      // A real Writable emits close without finish when destroyed early.
      h.output.destroy();
      assert.match((await settles(h.outcome)).message, /TXT_CODE_backup.outputClosedEarly/);
      assert.equal(h.output.closed, true);
      assert.equal(h.output.writableFinished, false);
      assertFailedClose(h, "TXT_CODE_backup.outputClosedEarly");
    }
  );
}

test(
  "real finished output may close before archive end and finalize promise resolution",
  { timeout: 2000 },
  async () => {
    const h = fixture({ createOutput: createWritableOutput });
    h.start();
    const closed = once(h.output, "close");
    h.output.end("inert output bytes");
    await closed;
    assert.equal(h.output.writableFinished, true);
    active(h.task, "archive");
    assert.throws(() => h.acquireInstanceOperation("progress-fixture"), /already running/);
    h.endArchive();
    // A normal archive close after end must not reject a pending finalize promise.
    h.closeArchive();
    await turn();
    active(h.task, "finalization");
    h.finalize.resolve();
    assert.equal(await settles(h.outcome), undefined);
    assert.equal(h.task.progress.completed, true);
    assert.ok(!h.logs.some((x) => x.level === "ERROR"));
    h.acquireInstanceOperation("progress-fixture")();
  }
);

const completionOrders = [
  ["end", "finalize", "output"],
  ["end", "output", "finalize"],
  ["finalize", "end", "output"],
  ["finalize", "output", "end"],
  ["output", "end", "finalize"],
  ["output", "finalize", "end"]
];
for (const order of completionOrders) {
  test(
    "finished output preserves valid completion order " + order.join(" -> "),
    { timeout: 2000 },
    async () => {
      const h = fixture();
      h.start();
      h.output.writableFinished = true;
      const emit = {
        end: () => h.endArchive(),
        finalize: () => h.finalize.resolve(),
        output: () => h.closeOutput()
      };
      for (let i = 0; i < order.length; i++) {
        emit[order[i]]();
        await turn();
        if (i < order.length - 1) active(h.task);
      }
      assert.equal(await settles(h.outcome), undefined);
      assert.equal(h.task.progress.completed, true);
      assert.ok(!h.logs.some((x) => x.level === "ERROR"));
      h.acquireInstanceOperation("progress-fixture")();
    }
  );
}

test(
  "intentional cancellation tolerates archive close without end and unfinished real output",
  { timeout: 2000 },
  async () => {
    const h = fixture({ createOutput: createWritableOutput });
    h.start();
    // Abort closes this source without ever emitting end, as real destroyed
    // transforms can do. Output destroy also closes without writable finish.
    h.archive.resume = () => {};
    h.archive.abort = () => {
      queueMicrotask(() => {
        h.archive.destroyed = true;
        h.closeArchive();
      });
    };
    await settles(h.task.stop());
    assert.equal(await settles(h.outcome), undefined);
    assert.equal(h.output.writableFinished, false);
    assert.equal(h.task.status(), 0);
    assert.equal(h.task.progress.phase, "cancelled");
    assert.equal(h.task.progress.completed, false);
    assert.ok(!h.logs.some((x) => x.level === "ERROR"));
    assert.ok(!h.logs.some((x) => x.message === "TXT_CODE_backup.success"));
    h.acquireInstanceOperation("progress-fixture")();
  }
);

test(
  "archive close followed by a same-turn source error preserves the primary failure",
  { timeout: 2000 },
  async () => {
    const h = fixture();
    h.start();
    const primary = Error("primary source failure after close");
    h.archive.destroyed = true;
    h.closeArchive();
    h.archive.emit("error", primary);
    assert.equal(await settles(h.outcome), primary);
    assertFailedClose(h, primary.message);
    assert.ok(!h.logs.some((x) => x.message === "TXT_CODE_backup.archiveClosedEarly"));
  }
);
