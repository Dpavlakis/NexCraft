"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { once } = require("node:events");
const Module = require("node:module");
const root = path.resolve(__dirname, "../..");
const load = Module.createRequire(path.join(root, "daemon/package.json"));
test("daemon initKoa real upload passport/manager, file bytes, cleanup and pre-parser denial", { timeout: 15000 }, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "nexcraft-upload-"));
  const incoming = path.join(temp, "incoming"), destination = path.join(temp, "instance");
  await fs.mkdir(incoming); await fs.mkdir(destination);
  load("ts-node").register({ project: path.join(root, "daemon/tsconfig.json"), transpileOnly: true });
  const originalLoad = Module._load, originalInterval = global.setInterval;
  const logger = { error() {}, info() {}, warn() {} };
  const config = { config: { prefix: "", uploadSpeedRate: 0 } };
  let allocations = 0;
  global.setInterval = (...args) => originalInterval(...args).unref();
  Module._load = function(id, parent, ...args) {
    if (parent?.filename?.startsWith(path.join(root, "daemon/src"))) {
      if (/\/(i18n|log)$/.test(id)) return id.endsWith("i18n") ? { $t: s => s, i18next: { language: "en_us" } } : { __esModule: true, default: logger };
      if (id.endsWith("/entity/config") || (id === "./config" && parent.filename.endsWith("/entity/file_writer.ts"))) return { globalConfiguration: config };
      if (id.endsWith("/system_instance")) return { __esModule: true, default: { getInstance: uuid => uuid === "fixture" ? { absoluteCwdPath: () => destination } : undefined } };
      if (id.endsWith("/common/system_storage")) return { __esModule: true, default: {} };
      if (id.endsWith("/backup_service")) return { __esModule: true, default: {} };
      // Zip execution is outside this upload fixture; filesystem validation stays real.
      if (id.endsWith("/common/compress")) return { compress() { throw Error("unexpected zip"); }, decompress() { throw Error("unexpected unzip"); } };
      if (id === "mcsmanager-common") return { removeTrail: (s, suffix) => s.endsWith(suffix) ? s.slice(0, -suffix.length) : s, ProcessWrapper: class {} };
      if (id === "koa-body") {
        const actual = originalLoad.call(this, id, parent, ...args);
        const wrapped = options => actual.koaBody({ ...options, formidable: { ...options.formidable,
          uploadDir: incoming, onFileBegin() { allocations++; } } });
        return { ...actual, default: wrapped, koaBody: wrapped, __esModule: true };
      }
    }
    return originalLoad.call(this, id, parent, ...args);
  };
  let initKoa, passport, uploads;
  try {
    ({ initKoa } = require("../../daemon/src/service/http.ts"));
    passport = require("../../daemon/src/service/mission_passport.ts").missionPassport;
    uploads = require("../../daemon/src/service/upload_manager.ts").default;
  } finally { Module._load = originalLoad; global.setInterval = originalInterval; }
  const app = initKoa(); app.on("error", () => {});
  const server = http.createServer(app.callback()); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    assert.equal([...uploads.getUploads()].length, 0);
    const denied = new FormData(); denied.append("file", new Blob(["denied"]), "denied.txt");
    assert.ok((await fetch(url + "/upload/invalid", { method: "POST", body: denied })).status >= 400);
    assert.equal(allocations, 0); assert.deepEqual(await fs.readdir(incoming), []);
    passport.registerMission("fixture-passport", { name: "upload", parameter: { instanceUuid: "fixture", uploadDir: "." }, start: Date.now(), end: Date.now() + 60000 });
    const body = new FormData(); body.append("file", new Blob(["actual route bytes"]), "fixture.txt");
    const response = await fetch(url + "/upload/fixture-passport", { method: "POST", body });
    assert.equal(response.status, 200); assert.equal(await response.text(), "OK");
    assert.equal(await fs.readFile(path.join(destination, "fixture.txt"), "utf8"), "actual route bytes");
    assert.equal(passport.missions.get("fixture-passport").isDeleted, true);
    assert.equal(allocations, 1); assert.deepEqual(await fs.readdir(incoming), []);
  } finally {
    server.closeAllConnections(); await new Promise(r => server.close(r)); await uploads.exit();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
