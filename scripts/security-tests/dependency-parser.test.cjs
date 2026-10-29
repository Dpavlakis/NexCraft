"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { once } = require("node:events");
const { createRequire } = require("node:module");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");
const req = tree => createRequire(path.join(root, tree, "package.json"));
async function serve(app, run) {
  const server = http.createServer(app.callback());
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
}
function request(url, method, body, type) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method, headers: { "content-type": type, "content-length": Buffer.byteLength(body) } }, response => {
      const chunks = []; response.on("data", b => chunks.push(b));
      response.on("end", () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString() }));
    }); r.on("error", reject); r.end(body);
  });
}
// Execute actual application options, including parsed methods and onError.
async function parser(tree, tweak = x => x) {
  const load = req(tree), ts = load("typescript");
  const candidates = tree === "panel"
    ? ["src/app/service/authentication.ts", "src/app.ts"] : ["src/service/http.ts"];
  let expression;
  for (const candidate of candidates) {
    const file = path.join(root, tree, candidate);
    let source;
    try { source = await fs.readFile(file, "utf8"); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === "koaBody") expression = node.getText(ast);
      ts.forEachChild(node, visit);
    }
    visit(ast);
    if (expression) break;
  }
  assert.ok(expression, "actual production parser exists");
  const script = ts.transpileModule(expression + ";", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(script, {
    koaBody: options => load("koa-body").koaBody(tweak(options)),
    HttpMethodEnum: load("koa-body").HttpMethodEnum, logger: { error() {} }
  });
}

for (const tree of ["daemon", "panel"]) {
  test(tree + ": actual parser JSON/form methods, multipart shape, errors and limits", { timeout: 20000 }, async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "nexcraft-parser-"));
    const load = req(tree), Koa = load("koa"), app = new Koa(); app.on("error", () => {});
    app.use(await parser(tree, options => {
      assert.equal(options.formidable.maxFileSize, 1024 * 1024 * (tree === "panel" ? 500 : 100));
      return { ...options, formidable: { ...options.formidable, uploadDir: tmp } };
    }));
    app.use(async ctx => {
      const files = ctx.request.files?.file, file = Array.isArray(files) ? files[0] : files;
      ctx.body = file ? { name: file.originalFilename, text: await fs.readFile(file.filepath, "utf8"), array: Array.isArray(files), field: ctx.request.body.label }
        : { data: ctx.request.body };
    });
    try {
      await serve(app, async url => {
        for (const method of tree === "panel" ? ["GET", "PUT", "POST", "DELETE"] : ["POST", "PUT", "PATCH"]) {
          const json = await request(url, method, '{"value":7}', "application/json");
          assert.equal(json.status, 200); assert.deepEqual(JSON.parse(json.text).data, { value: 7 });
          const form = await request(url, method, "value=seven", "application/x-www-form-urlencoded");
          assert.equal(form.status, 200); assert.equal(JSON.parse(form.text).data.value, "seven");
        }
        const form = new FormData(); form.append("file", new Blob(["fixture"]), "fixture.txt"); form.append("label", "metadata");
        const upload = await load("axios").post(url, form, { timeout: 3000 });
        assert.deepEqual(upload.data, { name: "fixture.txt", text: "fixture", array: false, field: "metadata" });
        // Current application logs and continues; record this existing error semantic.
        for (const body of ["{", JSON.stringify({ value: "x".repeat(10 * 1024 * 1024 + 1) })]) {
          const bad = await request(url, "POST", body, "application/json");
          assert.equal(bad.status, 200); assert.equal(JSON.parse(bad.text).data, undefined);
        }
      });
      const limited = new Koa(); limited.on("error", () => {});
      limited.use(await parser(tree, options => ({ ...options, onError: error => { throw error; },
        formidable: { ...options.formidable, uploadDir: tmp, maxFileSize: 1024 } })));
      limited.use(ctx => { ctx.body = "unexpected"; });
      await serve(limited, async url => {
        const large = new FormData(); large.append("file", new Blob(["x".repeat(2048)]), "large.txt");
        assert.ok((await fetch(url, { method: "POST", body: large })).status >= 400);
        const two = new FormData(); for (const name of ["one", "two"]) two.append("file", new Blob([name]), name + ".txt");
        assert.ok((await fetch(url, { method: "POST", body: two })).status >= 400);
      });
    } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  });
}
