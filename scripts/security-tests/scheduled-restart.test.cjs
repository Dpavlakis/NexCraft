"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const load = createRequire(path.join(root, "daemon/package.json"));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function fixture(options = {}) {
  const callbacks = [], waits = [], commands = [], errors = [], intervals = [];
  const Instance = { STATUS_RUNNING: 3 };
  const instance = {
    instanceUuid: "fixture", state: 3,
    config: { scheduledRestart: { enabled: true, scheduleType: 0, cron: "0 * * * *", warningSeconds: [60, 10], ...options } },
    status() { return this.state; },
    execPreset(...args) { commands.push(args); return commandGate ? commandGate.promise : Promise.resolve(); }
  };
  let commandGate;
  const filename = path.join(root, "daemon/src/service/scheduled_restart_service.ts");
  const js = load("typescript").transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: 1, target: 9, esModuleInterop: true }
  }).outputText;
  const module = { exports: {} };
  const job = callback => { const entry = { callback, cancelled: false, cancel() { this.cancelled = true; } }; callbacks.push(entry); return entry; };
  const mocks = {
    "node-schedule": { scheduleJob: (_cron, callback) => job(callback) },
    "../entity/instance/instance": Instance,
    "./log": { info() {}, warn() {}, error(e) { errors.push(e); } },
    "../utils/sleep": { sleep(ms) { const wait = deferred(); waits.push({ ms, ...wait }); return wait.promise; } }
  };
  vm.runInThisContext("(function(require,module,exports,setInterval,clearInterval){" + js + "\n})", { filename })(
    name => { assert.ok(name in mocks, "unexpected dependency " + name); return mocks[name]; }, module, module.exports,
    (callback, ms) => { const entry = job(callback); intervals.push({ ms, entry }); return entry; }, handle => handle.cancel()
  );
  const service = module.exports.default;
  return { service, instance, callbacks, waits, commands, errors, intervals,
    arm() { service.applyForInstance(instance); return callbacks.at(-1).callback; },
    holdCommand() { return commandGate = deferred(); }, releaseCommands() { commandGate = undefined; } };
}
for (const action of ["disable", "cancel", "reapply"]) {
  test("restart countdown: " + action + " during sleep admits no later command", async () => {
    const f = fixture(), fire = f.arm(); fire(); await settle();
    assert.deepEqual(f.commands, [["command", "say Server restarting in 1 minute..."]]);
    assert.equal(f.waits[0].ms, 50000);
    if (action === "disable") { f.instance.config.scheduledRestart.enabled = false; f.service.applyForInstance(f.instance); }
    else if (action === "cancel") f.service.cancelForInstance("fixture");
    else f.arm();
    f.waits[0].resolve(); await settle();
    assert.equal(f.commands.length, 1);
    // A saved callback cannot start after cancellation, even with enabled=true.
    f.instance.config.scheduledRestart.enabled = true; fire(); await settle();
    assert.equal(f.commands.length, 1);
    assert.deepEqual(f.errors, []);
  });
}
for (const rejects of [false, true]) {
  test("restart countdown: cancellation while say is pending (" + (rejects ? "reject" : "resolve") + ")", async () => {
    const f = fixture(), pending = f.holdCommand(), fire = f.arm(); fire(); await settle();
    f.service.cancelForInstance("fixture");
    // Cancellation must invalidate even when the job entry has already gone.
    f.service.cancelForInstance("fixture");
    if (rejects) pending.reject(new Error("fixture command failure")); else pending.resolve();
    await settle();
    assert.equal(f.commands.length, 1); assert.equal(f.waits.length, 0); assert.deepEqual(f.errors, []);
  });
}
test("restart countdown: old finally cannot unlock a replacement run", async () => {
  const f = fixture(), old = f.arm(); old(); await settle();
  const current = f.arm(); current(); await settle();
  assert.equal(f.commands.length, 2, "new schedule starts without waiting for invalidated sleep");
  f.waits[0].resolve(); await settle();
  current(); await settle();
  assert.equal(f.commands.length, 2, "old cleanup must leave replacement overlap marker owned");
  f.waits[1].resolve(); await settle();
  assert.deepEqual(f.commands.at(-1), ["command", "say Server restarting in 10 seconds..."]);
  f.waits[2].resolve(); await settle();
  assert.deepEqual(f.commands.at(-1), ["restart"]);
  assert.equal(f.commands.filter(c => c[0] === "restart").length, 1);
});
for (const scheduleType of [0, 1]) {
  test("restart countdown: uninterrupted " + (scheduleType ? "interval" : "cron") + " ordering and overlap", async () => {
    const f = fixture({ scheduleType, intervalSeconds: 1, warningSeconds: [1, 3600, 60, 0, -1], warningMessage: "Restart in {time}" });
    const fire = f.arm();
    if (scheduleType) assert.equal(f.intervals[0].ms, 60000, "minimum interval remains 60 seconds");
    fire(); fire(); await settle();
    assert.deepEqual(f.commands, [["command", "say Restart in 1 hour"]]);
    assert.equal(f.waits[0].ms, 3540000); f.waits[0].resolve(); await settle();
    assert.deepEqual(f.commands.at(-1), ["command", "say Restart in 1 minute"]);
    assert.equal(f.waits[1].ms, 59000); f.waits[1].resolve(); await settle();
    assert.deepEqual(f.commands.at(-1), ["command", "say Restart in 1 second"]);
    assert.equal(f.waits[2].ms, 1000); f.waits[2].resolve(); await settle();
    assert.deepEqual(f.commands.at(-1), ["restart"]);
    assert.equal(f.commands.length, 4); assert.deepEqual(f.errors, []);
    // A completed sequence releases its own marker.
    f.instance.config.scheduledRestart.warningSeconds = []; fire(); await settle();
    assert.equal(f.commands.filter(c => c[0] === "restart").length, 2);
  });
}
test("restart countdown: stopped/disabled entry and status change during awaits", async () => {
  const f = fixture(), fire = f.arm();
  f.instance.state = 0; fire(); await settle(); assert.equal(f.commands.length, 0);
  f.instance.state = 3; f.instance.config.scheduledRestart.enabled = false; fire(); await settle(); assert.equal(f.commands.length, 0);
  f.instance.config.scheduledRestart.enabled = true;
  const command = f.holdCommand(); fire(); await settle();
  f.instance.state = 0; command.resolve(); await settle(); assert.equal(f.waits.length, 0);
  f.releaseCommands(); f.instance.state = 3; fire(); await settle();
  f.instance.state = 0; f.waits[0].resolve(); await settle();
  assert.equal(f.commands.filter(c => c[0] === "restart").length, 0);
  assert.equal(f.commands.length, 2);
});
test("restart countdown: ordinary warning failure still allows a live restart", async () => {
  const f = fixture({ warningSeconds: [1] }), command = f.holdCommand(), fire = f.arm();
  fire(); await settle(); command.reject(new Error("fixture command failure")); f.releaseCommands(); await settle();
  assert.equal(f.waits[0].ms, 1000); f.waits[0].resolve(); await settle();
  assert.deepEqual(f.commands.at(-1), ["restart"]); assert.deepEqual(f.errors, []);
});
