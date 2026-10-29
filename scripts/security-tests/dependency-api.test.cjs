"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { once } = require("node:events");
const { Readable, PassThrough } = require("node:stream");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const req = tree => createRequire(path.join(root, tree, "package.json"));
async function listen(server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return "http://127.0.0.1:" + server.address().port;
}
async function close(server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
for (const tree of ["common", "daemon", "panel"]) {
  test(tree + ": polling/WebSocket JSON and binary acknowledgments/disconnect", { timeout: 15000 }, async () => {
    const server = http.createServer(), { Server } = req(tree)("socket.io"), io = new Server(server);
    let disconnect;
    io.on("connection", socket => {
      socket.on("echo", (value, ack) => ack(value));
      socket.on("disconnect", () => disconnect?.());
    });
    const url = await listen(server);
    try {
      for (const clientTree of ["daemon", "panel", "frontend"]) for (const transport of ["polling", "websocket"]) {
        const client = req(clientTree)("socket.io-client").io(url, { transports: [transport], reconnection: false, timeout: 3000 });
        try {
          await Promise.race([once(client, "connect"), once(client, "connect_error").then(([e]) => { throw e; })]);
          const result = await client.timeout(3000).emitWithAck("echo", { text: "fixture", bytes: Buffer.from([0, 127, 255]) });
          assert.equal(result.text, "fixture"); assert.deepEqual(Array.from(result.bytes), [0, 127, 255]);
          const disconnected = new Promise(r => { disconnect = r; });
          client.disconnect(); await disconnected;
        } finally { client.disconnect(); }
      }
    } finally { await new Promise(r => io.close(r)); }
  });
}
test("tar strip extraction and TOML round-trip/rejection", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcraft-archive-"));
  try {
    await fs.mkdir(path.join(dir, "input/jdk/bin"), { recursive: true }); await fs.mkdir(path.join(dir, "out"));
    await fs.writeFile(path.join(dir, "input/jdk/bin/java"), "fixture-jre");
    const tar = req("daemon")("tar"), file = path.join(dir, "jdk.tar.gz");
    await tar.c({ cwd: path.join(dir, "input"), file, gzip: true }, ["jdk"]);
    await tar.extract({ file, cwd: path.join(dir, "out"), strip: 1 });
    assert.equal(await fs.readFile(path.join(dir, "out/bin/java"), "utf8"), "fixture-jre");
    const toml = req("daemon")("smol-toml"), data = { name: "fixture", values: [1, 2], nested: { enabled: true } };
    assert.deepEqual(JSON.parse(JSON.stringify(toml.parse(toml.stringify(data)))), data); assert.throws(() => toml.parse("broken = ["));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test("Axios redirects strip credentials across origins and stream exact bytes", { timeout: 10000 }, async () => {
  const bytes = Buffer.from("fixture bytes\u0000\u00ff");
  const target = http.createServer((r, s) => {
    if (r.url === "/headers") { s.setHeader("content-type", "application/json"); return s.end(JSON.stringify(r.headers)); }
    if (r.method === "POST") { r.pipe(s); } else { s.end(bytes); }
  });
  const targetUrl = await listen(target);
  const redirect = http.createServer((r, s) => { s.writeHead(302, { location: targetUrl + (r.url === "/headers" ? "/headers" : "/bytes") }); s.end(); });
  const url = await listen(redirect);
  try {
    for (const tree of ["daemon", "panel", "frontend"]) {
      const axios = req(tree)("axios");
      const headers = (await axios.get(url.replace("127.0.0.1", "localhost") + "/headers", {
        headers: { Authorization: "Bearer fixture", Cookie: "fixture=secret" }, proxy: false, timeout: 3000
      })).data;
      assert.equal(headers.authorization, undefined); assert.equal(headers.cookie, undefined);
      const download = await axios.get(url + "/bytes", { responseType: "stream", timeout: 3000 });
      const chunks = []; for await (const b of download.data) chunks.push(b); assert.deepEqual(Buffer.concat(chunks), bytes);
      const uploaded = await axios.post(targetUrl, Readable.from([bytes]), { responseType: "arraybuffer", timeout: 3000 });
      assert.deepEqual(Buffer.from(uploaded.data), bytes);
    }
  } finally { await close(redirect); await close(target); }
});
test("Dockerode version/info/list/inspect and modem progress/demux APIs", { timeout: 10000 }, async () => {
  const seen = [];
  const server = http.createServer((r, s) => {
    seen.push(r.url); s.setHeader("content-type", "application/json");
    if (r.url === "/version") s.end(JSON.stringify({ Version: "fixture" }));
    else if (r.url === "/info") s.end(JSON.stringify({ Containers: 1 }));
    else if (r.url === "/containers/json") s.end(JSON.stringify([{ Id: "fixture" }]));
    else if (r.url === "/containers/fixture/json") s.end(JSON.stringify({ Id: "fixture", State: { Running: false } }));
    else { s.statusCode = 404; s.end("{}"); }
  });
  await listen(server);
  try {
    const Docker = req("daemon")("dockerode"), docker = new Docker({ host: "127.0.0.1", port: server.address().port, protocol: "http" });
    assert.equal((await docker.version()).Version, "fixture"); assert.equal((await docker.info()).Containers, 1);
    assert.equal((await docker.listContainers())[0].Id, "fixture"); assert.equal((await docker.getContainer("fixture").inspect()).State.Running, false);
    assert.equal(seen.length, 4);
    const progress = await new Promise((resolve, reject) => docker.modem.followProgress(
      Readable.from(['{"status":"pulling"}\n{"status":"done"}\n']), (e, v) => e ? reject(e) : resolve(v)));
    assert.equal(progress[1].status, "done");
    const output = new PassThrough(), errors = new PassThrough(), out = [], err = [];
    output.on("data", b => out.push(b)); errors.on("data", b => err.push(b));
    function frame(type, text) { const b = Buffer.from(text), h = Buffer.alloc(8); h[0] = type; h.writeUInt32BE(b.length, 4); return Buffer.concat([h, b]); }
    const input = new PassThrough(); docker.modem.demuxStream(input, output, errors);
    input.end(Buffer.concat([frame(1, "stdout"), frame(2, "stderr")]));
    await once(input, "end"); assert.equal(Buffer.concat(out).toString(), "stdout"); assert.equal(Buffer.concat(err).toString(), "stderr");
  } finally { await close(server); }
});
test("UUID CommonJS and signed session round-trip/tamper/expiry/logout", { timeout: 10000 }, async () => {
  for (const tree of ["daemon", "panel", "frontend"]) assert.match(req(tree)("uuid").v4(), /^[0-9a-f-]{36}$/);
  const load = req("panel"), Koa = load("koa"), sessionModule = load("koa-session");
  const session = sessionModule.default || sessionModule, app = new Koa(); app.keys = ["fixture-signing-key"];
  app.use(session({ key: "fixture", maxAge: 86400000, httpOnly: true, signed: true, rolling: false, renew: false }, app));
  app.use(ctx => { if (ctx.path === "/login") ctx.session.user = "fixture"; if (ctx.path === "/logout") ctx.session = null; ctx.body = { user: ctx.session?.user || null }; });
  const server = http.createServer(app.callback()), url = await listen(server);
  try {
    const logged = await fetch(url + "/login"); const cookies = logged.headers.getSetCookie();
    assert.ok(cookies.some(c => /httponly/i.test(c))); assert.ok(cookies.some(c => /expires=/i.test(c)));
    const cookie = cookies.map(c => c.split(";")[0]).join("; ");
    assert.equal((await (await fetch(url, { headers: { cookie } })).json()).user, "fixture");
    const tampered = cookie.replace(/fixture=([^;]+)/, (_, v) => "fixture=" + (v[0] === "A" ? "B" : "A") + v.slice(1));
    assert.equal((await (await fetch(url, { headers: { cookie: tampered } })).json()).user, null);
    const logout = await fetch(url + "/logout", { headers: { cookie } });
    assert.ok(logout.headers.getSetCookie().some(c => c.startsWith("fixture=;")));
  } finally { await close(server); }
});

test("session server rejects an expired signed session even when its cookie is replayed", { timeout: 5000 }, async () => {
  const load = req("panel"), Koa = load("koa"), sessionModule = load("koa-session");
  const app = new Koa(); app.keys = ["expiry-fixture"];
  app.use((sessionModule.default || sessionModule)({ key: "expiry", maxAge: 25, signed: true, rolling: false, renew: false }, app));
  app.use(ctx => { if (ctx.path === "/issue") ctx.session.user = "fixture"; ctx.body = { user: ctx.session?.user || null }; });
  const server = http.createServer(app.callback()), url = await listen(server);
  try {
    const response = await fetch(url + "/issue");
    const cookie = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    await new Promise(r => setTimeout(r, 50));
    assert.equal((await (await fetch(url, { headers: { cookie } })).json()).user, null);
  } finally { await close(server); }
});
