"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const http = require("node:http");
const { once } = require("node:events");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
async function fixture(tree, smallMultipart = false) {
  const load = createRequire(path.join(root, tree, "package.json"));
  const ts = load("typescript"), temp = await fsp.mkdtemp(path.join(os.tmpdir(), "nexcraft-rejection-"));
  const base = path.join(root, tree, "src"), mocks = new Map(), cache = new Map();
  const state = { calls: 0, allocations: 0, parserOptions: undefined, logs: [] };
  const logger = { info() {}, warn() {}, error(...args) { state.logs.push(args); } };
  function mock(name, value) { mocks.set(path.join(base, name + ".ts"), value); }
  function source(filename) {
    if (mocks.has(filename)) return mocks.get(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const js = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText;
    vm.runInThisContext("(function(require,module,exports){" + js + "\n})", { filename })(name => {
      if (name === "koa-body") {
        const actual = load(name);
        return { ...actual, koaBody(options) {
          state.parserOptions = options;
          return actual.koaBody({ ...options, formidable: { ...options.formidable, uploadDir: temp,
            ...(smallMultipart ? { maxFileSize: 1024 } : {}), onFileBegin() { state.allocations++; } } });
        } };
      }
      if (name === "mcsmanager-common") return { removeTrail: (s, suffix) => s.endsWith(suffix) ? s.slice(0, -suffix.length) : s };
      if (name.startsWith(".")) return source(path.resolve(path.dirname(filename), name + ".ts"));
      return load(name);
    }, module, module.exports);
    return module.exports;
  }
  async function handler(ctx) {
    state.calls++;
    if (ctx.path.endsWith("/app-error")) throw new Error("fixture application error");
    if (ctx.path.endsWith("/app-status-error")) throw Object.assign(new Error("fixture application error"), { status: 400 });
    if (tree === "panel" && ctx.path.endsWith("/security-error")) throw new (source(path.join(base, "app/service/security_error.ts")).SecurityError)(403, "fixture denied");
    if (tree === "panel" && ctx.path.endsWith("/session-error")) throw new (source(path.join(base, "app/service/security_error.ts")).SessionError)(409, "fixture expired");
    const files = ctx.request.files?.file, file = Array.isArray(files) ? files[0] : files;
    ctx.body = file ? { name: file.originalFilename, text: await fsp.readFile(file.filepath, "utf8"), field: ctx.request.body.label, array: Array.isArray(files) }
      : { body: ctx.request.body, session: tree === "panel" ? !!ctx.session : undefined };
  }
  let app, store;
  if (tree === "daemon") {
    mock("service/log", logger);
    mock("entity/config", { globalConfiguration: { config: { prefix: "", uploadSpeedRate: 0 } } });
    mock("service/mission_passport", { missionPassport: { getMission: key => key === "allowed" ? {} : undefined } });
    mock("service/upload_manager", { get() {} });
    mock("utils/speed_limit", { proxyIncomingMessage() { throw new Error("unexpected throttle"); } });
    mock("routers/http_router", { routes: () => handler, allowedMethods: () => async (_ctx, next) => next() });
    app = source(path.join(base, "service/http.ts")).initKoa();
  } else {
    mock("app/service/log", { logger });
    mock("app/service/user_service", { getInstance() {} });
    mock("app/service/two_factor_service", { configureSecurity() {} });
    mock("app/entity/user", { ROLE: { ADMIN: 10 } });
    mock("app/service/passport_service", { getUserFromCtx: ctx => ctx.get("x-fixture-admin") === "yes" ? { permission: 10 } : undefined });
    mock("app/service/visual_data", { addRequestCount() {} });
    mock("app/setting", { systemConfig: {} });
    mock("app/version", { getVersion: () => "fixture" });
    app = new (load("koa"))(); app.keys = ["fixture-signing-key"];
    const { SessionStore } = source(path.join(base, "app/service/session_store.ts"));
    store = new SessionStore(() => undefined, () => 123456789);
    source(path.join(base, "app/service/authentication.ts")).installAuthentication(app, store, "parser-test");
    app.use(source(path.join(base, "app/middleware/protocol.ts")).middleware);
    app.use(handler);
  }
  app.on("error", () => {});
  const server = http.createServer(app.callback()); server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { ...state, state, temp, url: "http://127.0.0.1:" + server.address().port,
    async close() { server.closeAllConnections(); await new Promise(r => server.close(r)); store?.close(); await fsp.rm(temp, { recursive: true, force: true }); } };
}
function request(url, body, options = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method: options.method || "POST", headers: {
      "content-type": options.type || "application/json", "content-length": Buffer.byteLength(body), ...options.headers
    } }, response => {
      const chunks = []; response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString(), headers: response.headers }));
    }); r.on("error", reject); r.end(body);
  });
}
for (const tree of ["daemon", "panel"]) {
  test(tree + ": mounted production boundary rejects malformed and real 10 MiB overflow before dispatch", { timeout: 15000 }, async () => {
    const f = await fixture(tree);
    try {
      assert.equal(f.state.parserOptions.jsonLimit, "10mb");
      for (const [body, status] of [["{", 400], ['{"private":"fixture-private-value",', 400], ["true", 400], [JSON.stringify({ value: "x".repeat(10 * 1024 * 1024 + 1) }), 413]]) {
        const result = await request(f.url + "/api/mutate", body);
        assert.equal(result.status, status); assert.equal(f.state.calls, 0);
        assert.equal(result.text, status === 413 ? "Request body too large" : "Invalid request body");
      }
      // Parser logs must never receive parser error objects containing raw bodies.
      assert.ok(f.state.logs.every(args => args.every(arg => typeof arg === "string" && !arg.includes("fixture-private-value"))));
      const unsupported = await request(f.url + "/api/mutate", "{}", { headers: { "content-encoding": "unsupported" } });
      assert.equal(unsupported.status, 415); assert.equal(f.state.calls, 0);
      const methods = tree === "panel" ? ["GET", "PUT", "POST", "DELETE"] : ["POST", "PUT", "PATCH"];
      for (const method of methods) {
        const result = await request(f.url + "/api/mutate", '{"value":7}', { method });
        assert.equal(result.status, 200);
        const value = JSON.parse(result.text), data = tree === "panel" ? value.data : value;
        assert.deepEqual(data.body, { value: 7 }); if (tree === "panel") assert.equal(data.session, true);
      }
      assert.equal(f.state.calls, methods.length);
    } finally { await f.close(); }
  });
  test(tree + ": mounted boundary preserves ordinary application errors" + (tree === "panel" ? " and typed security/session bridge" : ""), async () => {
    const f = await fixture(tree);
    try {
      const result = await request(f.url + "/api/app-error", "{}");
      assert.equal(result.status, 500); assert.equal(f.state.calls, 1);
      if (tree === "panel") {
        assert.equal(JSON.parse(result.text).data, "fixture application error");
        const statusError = await request(f.url + "/api/app-status-error", "{}");
        assert.equal(statusError.status, 500, "protocol retains ordinary application Error classification");
        for (const [route, status, message] of [["security-error", 403, "fixture denied"], ["session-error", 409, "fixture expired"]]) {
          const typed = await request(f.url + "/api/" + route, "{}");
          assert.equal(typed.status, status); assert.deepEqual(JSON.parse(typed.text), { status, data: message, time: 123456789 });
          if (route === "session-error") assert.ok(typed.headers["set-cookie"].some(c => c.startsWith("parser-test=;")));
        }
      }
    } finally { await f.close(); }
  });
  test(tree + ": mounted multipart precheck, valid file shape and scaled overflow/max-file rejection", { timeout: 10000 }, async () => {
    const f = await fixture(tree, true);
    const multipart = (files = ["fixture"]) => {
      const body = new FormData(); body.append("label", "metadata");
      for (const [i, text] of files.entries()) body.append("file", new Blob([text]), i === 0 ? "fixture.txt" : "other.txt");
      return body;
    };
    try {
      assert.equal(f.state.parserOptions.formidable.maxFileSize, 1024 * 1024 * (tree === "panel" ? 500 : 100));
      assert.equal(f.state.parserOptions.formidable.maxFiles, 1);
      const denied = await fetch(f.url + "/upload/denied", { method: "POST", body: multipart() });
      assert.equal(denied.status, 500); assert.equal(f.state.calls, 0); assert.equal(f.state.allocations, 0);
      assert.deepEqual(await fsp.readdir(f.temp), []);
      const headers = tree === "panel" ? { "x-fixture-admin": "yes" } : {};
      const valid = await fetch(f.url + "/upload/allowed", { method: "POST", headers, body: multipart() });
      assert.equal(valid.status, 200);
      const value = await valid.json(), data = tree === "panel" ? value.data : value;
      assert.deepEqual(data, { name: "fixture.txt", text: "fixture", field: "metadata", array: false }); assert.equal(f.state.calls, 1);
      // Formidable emits a plain parser Error with httpCode=400 for a missing boundary.
      const malformed = await request(f.url + "/upload/allowed", "fixture-data", { type: "multipart/form-data", headers });
      assert.equal(malformed.status, 400); assert.equal(malformed.text, "Invalid request body");
      assert.equal(f.state.calls, 1); assert.equal(f.state.allocations, 1);
      for (const files of [["x".repeat(2048)], ["one", "two"]]) {
        const invalid = await fetch(f.url + "/upload/allowed", { method: "POST", headers, body: multipart(files) });
        assert.equal(invalid.status, 413); assert.equal(f.state.calls, 1);
        assert.equal(await invalid.text(), "Request body too large");
      }
    } finally { await f.close(); }
  });
}
