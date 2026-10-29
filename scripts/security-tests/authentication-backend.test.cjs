"use strict";
const { test, beforeEach, afterEach, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path"),
  fs = require("node:fs"),
  os = require("node:os");
const http = require("node:http"),
  { once } = require("node:events"),
  Module = require("node:module");
const root = path.resolve(__dirname, "../.."),
  panel = path.join(root, "panel");
const dep = (name) => require(path.join(panel, "node_modules", name));
require(path.join(panel, "node_modules/ts-node")).register({
  project: path.join(panel, "tsconfig.json"),
  transpileOnly: true
});
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...args) {
  if (name === "mcsmanager-common") name = path.join(root, "common/src/index.ts");
  if (name.startsWith("@languages/")) name = path.join(root, "languages", name.slice(11));
  return originalResolve.call(this, name, parent, ...args);
};
const logs = [],
  qrUris = [];
let qrFailure = false,
  providerGate,
  providerCalls = 0;
const actualQR = dep("qrcode");
const provider = {
  generateState: () => require("node:crypto").randomBytes(24).toString("hex"),
  generateNonce: () => "test-nonce",
  generateCodeVerifier: () => "test-verifier",
  buildAuthorizationUrl: async (state) => "https://provider.example/authorize?state=" + state,
  getCallbackUrl: () => "http://localhost/api/auth/sso/callback",
  getPublicSsoConfig: () => ({}),
  async handleOIDCCallback(url, state, nonce, verifier) {
    providerCalls++;
    assert.equal(url.searchParams.get("state"), state);
    assert.equal(nonce, "test-nonce");
    assert.equal(verifier, "test-verifier");
    if (providerGate) {
      providerGate.enter();
      await providerGate.wait;
    }
    return { sub: url.searchParams.get("code") || "provider-user", claims: { sub: "verified" } };
  },
  async handleOAuth2Callback(code, verifier) {
    providerCalls++;
    assert.equal(verifier, "test-verifier");
    return { sub: code, claims: { sub: code } };
  }
};
const originalLoad = Module._load;
Module._load = function (name, parent, ...args) {
  if (parent?.filename.startsWith(path.join(panel, "src"))) {
    if (/(?:^|\/)log$/.test(name))
      return {
        logger: new Proxy(
          {},
          {
            get:
              () =>
              (...values) =>
                logs.push(values)
          }
        )
      };
    if (/(?:^|\/)operation_logger$/.test(name))
      return {
        operationLogger: new Proxy(
          {},
          {
            get:
              () =>
              (...values) =>
                logs.push(values)
          }
        )
      };
    if (name === "../service/sso_service") return provider;
    if (name === "qrcode")
      return {
        ...actualQR,
        toDataURL: async (uri) => {
          qrUris.push(uri);
          if (qrFailure) throw new Error("QR provider failed");
          return actualQR.toDataURL(uri);
        }
      };
  }
  return originalLoad.call(this, name, parent, ...args);
};
// Clock boundary: imported metrics timers should not keep the worker alive.
const originalInterval = global.setInterval;
global.setInterval = (...args) => {
  const timer = originalInterval(...args);
  timer.unref();
  return timer;
};
const src = (name) => require(path.join(panel, "src/app", name));
const { User } = src("entity/user.ts"),
  users = src("service/user_service.ts").default;
const storage = src("common/storage/sys_storage.ts").default;
const realFileStore = src("common/storage/file_storage.ts").default;
const { StorageSubsystem, GlobalVariable } = require(path.join(root, "common/src/index.ts"));
const { UserWriteError, SessionError } = src("service/security_error.ts");
const { SessionStore } = src("service/session_store.ts");
const { installAuthentication } = src("service/authentication.ts");
const passport = src("service/passport_service.ts"),
  permission = src("middleware/permission.ts").default;
const protocol = src("middleware/protocol.ts").middleware;
const routers = [
  "manage_user_router",
  "login_router",
  "general_user_router",
  "user_overview_router",
  "sso_router",
  "instance_exchange_router"
].map((name) => src("routers/" + name + ".ts").default);
const exchangeTokens = src("service/user_sso_service.ts").default,
  settings = src("setting.ts");
global.setInterval = originalInterval;
Module._load = originalLoad;
const bcrypt = dep("bcryptjs"),
  md5 = dep("md5"),
  { authenticator } = dep("otplib");
const Koa = dep("koa"),
  Router = dep("@koa/router"),
  Keygrip = dep("keygrip");
const password = "Current123Aa",
  nextPassword = "Changed456Bb",
  disk = new Map();
let failure,
  writeGate,
  writeCount = 0,
  reloadFailure = false;
const backend = {
  async store(category, uuid, value) {
    writeCount++;
    if (writeGate) {
      writeGate.enter();
      await writeGate.wait;
    }
    if (failure === "definite") throw new UserWriteError(true);
    if (failure === "ambiguous-before") throw new Error("lost acknowledgement");
    disk.set(uuid, JSON.parse(JSON.stringify(value)));
    if (failure === "ambiguous-after") throw new Error("lost acknowledgement");
  },
  async load(category, clazz, uuid) {
    if (reloadFailure) throw new Error("unavailable");
    const value = disk.get(uuid);
    return value ? Object.assign(new clazz(), JSON.parse(JSON.stringify(value))) : null;
  },
  async list() {
    return [...disk.keys()];
  },
  async delete(category, uuid) {
    disk.delete(uuid);
  }
};
const actualGetStorage = storage.getStorage.bind(storage);
storage.getStorage = () => backend;
const apps = new Set();
function barrier(target = 1) {
  let enter,
    release,
    count = 0;
  const entered = new Promise((resolve) => {
      enter = () => {
        if (++count === target) resolve();
      };
    }),
    wait = new Promise((resolve) => {
      release = resolve;
    });
  return { enter, release, entered, wait };
}
function makeUser(uuid = "player", permission = 1, options = {}) {
  const user = Object.assign(
    new User(),
    {
      uuid,
      userName: uuid,
      permission,
      passWord: bcrypt.hashSync(password, 4),
      apiKey: uuid + "-api-key"
    },
    options
  );
  users.objects.set(uuid, user);
  disk.set(uuid, JSON.parse(JSON.stringify(user)));
  return user;
}
function code(secret) {
  return authenticator.generate(secret);
}
function stagedSecret() {
  return new URL(qrUris.at(-1)).searchParams.get("secret");
}
function badCode(secret) {
  return code(secret) === "000000" ? "111111" : "000000";
}
async function startApp(options = {}) {
  let now = Date.now();
  const app = new Koa();
  app.keys = ["stable-test-signing-key"];
  app.on("error", () => {});
  const store = new SessionStore(
    (uuid) => users.getInstance(uuid),
    () => now,
    options.limits
  );
  installAuthentication(app, store, "auth-test");
  app.use(protocol);
  const router = new Router({ prefix: "/api" });
  router.get("/plain", async (ctx) => {
    ctx.body = true;
  });
  router.get("/forged", async (ctx) => {
    ctx.session = { login: true, uuid: "player", token: "forged" };
    ctx.body = true;
  });
  router.get("/oversize", async (ctx) => {
    ctx.session.padding = "x".repeat(32769);
    ctx.body = true;
  });
  router.get("/protected-step", async (ctx) => {
    ctx.session.ssoState = String(ctx.query.value);
    require(path.join(panel, "src/app/service/session_store.ts")).sessionStore(ctx).checkpoint(ctx);
    ctx.body = true;
  });
  router.get("/identity", async (ctx) => {
    ctx.body = {
      uuid: passport.getUserUuid(ctx),
      name: passport.getUserNameBySession(ctx),
      role: passport.getUserPermission(ctx),
      found: !!passport.getUserFromCtx(ctx),
      check: passport.check(ctx)
    };
  });
  router.get("/ordinary", permission({ level: 1 }), async (ctx) => {
    if (passport.check(ctx)) {
      ctx.session.SESSION_REQ_TIMES = [now];
    }
    if (options.ordinaryGate) {
      options.ordinaryGate.enter();
      await options.ordinaryGate.wait;
    }
    ctx.body = true;
  });
  if (options.admissionGate)
    router.get(
      "/late-admission",
      async (ctx, next) => {
        // Load a valid identity, then revoke/change it before permission runs.
        assert.equal(ctx.session.login, true);
        options.admissionGate.enter();
        await options.admissionGate.wait;
        await next();
      },
      permission({ level: 1 }),
      (ctx) => {
        ctx.body = true;
      }
    );
  router.get("/admin-only", permission({ level: 10 }), async (ctx) => {
    ctx.body = true;
  });
  router.get("/deferred", permission({ level: 1, speedLimit: false }), async (ctx) => {
    ctx.session.SESSION_REQ_TIMES = [now];
    options.deferredGate.enter();
    await options.deferredGate.wait;
    ctx.body = true;
  });
  router.get("/deferred-protected", async (ctx) => {
    const saved = ctx.session.toJSON();
    options.protectedGate.enter();
    await options.protectedGate.wait;
    Object.assign(ctx.session, saved);
    ctx.session.extra = "stale security write";
    ctx.body = true;
  });
  if (options.loginGate)
    app.use(async (ctx, next) => {
      await next();
      if (ctx.path === "/api/auth/login") {
        options.loginGate.enter();
        await options.loginGate.wait;
      }
    });
  router.use(...routers.map((router) => router.routes()));
  app.use(router.routes());
  const server = http.createServer(app.callback());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const host = "http://127.0.0.1:" + server.address().port;
  const instance = {
    app,
    store,
    server,
    advance(ms) {
      now += ms;
    },
    async request(route, { cookie = "", token, method = "GET", body, headers = {} } = {}) {
      const url = new URL(route, host);
      if (token) url.searchParams.set("token", token);
      const data = body === undefined ? undefined : JSON.stringify(body);
      return new Promise((resolve, reject) => {
        const req = http.request(
          url,
          {
            method,
            headers: {
              "x-requested-with": "XMLHttpRequest",
              ...(cookie ? { cookie } : {}),
              ...(data
                ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) }
                : {}),
              ...headers
            }
          },
          (res) => {
            let text = "";
            res.on("data", (chunk) => {
              text += chunk;
            });
            res.on("end", () => {
              let json;
              try {
                json = JSON.parse(text);
              } catch {
                json = { data: text };
              }
              const cookies = res.headers["set-cookie"] || [];
              resolve({
                status: res.statusCode,
                data: json.data,
                text,
                headers: res.headers,
                cookie: cookies.map((value) => value.split(";")[0]).join("; ")
              });
            });
          }
        );
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
      });
    },
    async login(uuid = "player", pass = password, factor) {
      const res = await this.request("/api/auth/login", {
        method: "POST",
        body: { username: uuid, password: pass, ...(factor ? { code: factor } : {}) }
      });
      assert.equal(res.status, 200, res.text);
      assert.ok(res.cookie.includes("auth-test.sig="), res.text);
      return { cookie: res.cookie, token: res.data };
    },
    async stop() {
      store.close();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      apps.delete(instance);
    }
  };
  apps.add(instance);
  return instance;
}
beforeEach(() => {
  for (const user of users.objects.values()) users.onSecurityChange(user.uuid);
  users.objects.clear();
  disk.clear();
  logs.length = 0;
  qrUris.length = 0;
  GlobalVariable.map.clear();
  failure = undefined;
  writeGate = undefined;
  writeCount = 0;
  reloadFailure = false;
  qrFailure = false;
  providerGate = undefined;
  providerCalls = 0;
  settings.systemConfig = { totpDriftToleranceSteps: 0, ssoEnabled: false, ssoOnlyMode: false };
  makeUser();
  makeUser("admin", 10);
});
afterEach(async () => {
  for (const instance of [...apps]) await instance.stop();
});
after(async () => {
  for (const instance of [...apps]) await instance.stop();
  storage.getStorage = actualGetStorage;
  Module._resolveFilename = originalResolve;
});

test("real signed-cookie login/logout/replay, helpers, and opaque rotation", async () => {
  const h = await startApp(),
    session = await h.login();
  assert.match(session.cookie, /auth-test=[a-f0-9]{64}/);
  assert.equal((await h.request("/api/auth/token", session)).data, session.token);
  assert.equal((await h.request("/api/identity", session)).data.uuid, "player");
  assert.equal((await h.request("/api/auth/logout", session)).status, 200);
  assert.equal((await h.request("/api/auth/token", session)).status, 403);
  assert.deepEqual((await h.request("/api/identity", session)).data, {
    uuid: "",
    name: "",
    role: 0,
    found: false,
    check: false
  });
  const fresh = await h.login();
  assert.notEqual(fresh.cookie, session.cookie);
  assert.notEqual(fresh.token, session.token);
  assert.equal((await h.request("/api/auth/logout", session)).status, 200);
  assert.equal((await h.request("/api/auth/token", fresh)).status, 200);
  const log = JSON.stringify(logs);
  for (const secret of [
    session.token,
    fresh.token,
    session.cookie.split(";")[0].split("=")[1],
    password
  ])
    assert.equal(log.includes(secret), false);
});

test(
  "repeated overlapping ordinary signed-in waves exceed 48 at the same clock",
  { timeout: 10000 },
  async () => {
    const gate = barrier(128),
      h = await startApp({ ordinaryGate: gate }),
      session = await h.login();
    const requests = Array.from({ length: 128 }, () => h.request("/api/ordinary", session));
    await gate.entered;
    gate.release();
    assert.ok((await Promise.all(requests)).every((r) => r.status === 200));
    for (let wave = 0; wave < 3; wave++) {
      const responses = await Promise.all(
        Array.from({ length: 128 }, () => h.request("/api/ordinary", session))
      );
      assert.ok(responses.every((r) => r.status === 200));
    }
    // Ordinary preference writes under /auth are also unlimited.
    for (let wave = 0; wave < 2; wave++) {
      const responses = await Promise.all(
        Array.from({ length: 64 }, (_, i) =>
          h.request(i % 2 ? "/api/auth/avatar" : "/api/auth/theme", {
            ...session,
            method: "PUT",
            body: i % 2 ? { avatar: "data:image/png;base64,AA==" } : { theme: "nexcraft" }
          })
        )
      );
      assert.ok(responses.every((r) => r.status === 200));
    }
    assert.equal((await h.request("/api/ordinary", { ...session, token: "wrong" })).status, 403);
    assert.equal((await h.request("/api/admin-only", session)).status, 403);
    assert.equal((await h.request("/api/auth/token", session)).status, 200);
  }
);

test("signed-in login/install skip credential verification; anonymous login retains eight admissions", async () => {
  const h = await startApp(),
    session = await h.login();
  for (let wave = 0; wave < 4; wave++) {
    assert.ok(
      (
        await Promise.all(Array.from({ length: 128 }, () => h.request("/api/ordinary", session)))
      ).every((r) => r.status === 200)
    );
  }
  for (let wave = 0; wave < 2; wave++) {
    const responses = await Promise.all(
      Array.from({ length: 64 }, () =>
        h.request("/api/auth/login", {
          ...session,
          method: "POST",
          body: { username: "player", password: "wrong" }
        })
      )
    );
    assert.ok(responses.every((r) => r.status === 200 && r.data === "Logined"));
  }
  for (let i = 0; i < 64; i++) {
    const response = await h.request("/api/auth/install", {
      ...session,
      method: "POST",
      body: { username: "player", password }
    });
    assert.notEqual(response.status, 429);
  }
  const attempt = (cookie) =>
    h.request("/api/auth/login", {
      cookie,
      method: "POST",
      body: { username: "player", password: "wrong" }
    });
  const first = await attempt("");
  assert.notEqual(first.status, 429);
  assert.ok(first.cookie.includes("auth-test="));
  const admitted = await Promise.all(Array.from({ length: 7 }, () => attempt(first.cookie)));
  assert.ok(admitted.every((r) => r.status !== 429));
  const denied = await attempt(first.cookie);
  assert.equal(denied.status, 429);
  assert.equal(denied.headers["retry-after"], "1");
  assert.equal(denied.cookie, "");
  assert.equal((await h.request("/api/ordinary", session)).status, 200);
  assert.equal((await h.request("/api/auth/token", session)).status, 200);
  assert.equal((await h.request("/api/auth/status", session)).status, 200);
  h.advance(1001);
  assert.notEqual((await attempt(first.cookie)).status, 429);
});

for (const transition of ["revoke", "ban", "fingerprint", "delete", "expiry"])
  test(
    "ordinary admission rechecks the live store after loaded-session " + transition,
    async () => {
      const gate = barrier(),
        h = await startApp({ admissionGate: gate }),
        session = await h.login();
      const pending = h.request("/api/late-admission", session);
      await gate.entered;
      if (transition === "revoke") h.store.revoke("player");
      if (transition === "ban") users.getInstance("player").permission = -1;
      if (transition === "fingerprint") users.getInstance("player").passWord += "changed";
      if (transition === "delete") users.objects.delete("player");
      if (transition === "expiry") h.advance(86400001);
      gate.release();
      assert.equal((await pending).status, 429);
      assert.equal((await h.request("/api/identity", session)).data.found, false);
    }
  );

for (const transition of ["logout", "password", "admin-reset", "expiry", "eviction"])
  test("deferred ordinary save cannot resurrect after " + transition, async () => {
    const gate = barrier(),
      h = await startApp({ deferredGate: gate }),
      session = await h.login();
    const late = h.request("/api/deferred", session);
    await gate.entered;
    if (transition === "logout")
      assert.equal((await h.request("/api/auth/logout", session)).status, 200);
    if (transition === "password")
      assert.equal(
        (
          await h.request("/api/auth/update", {
            ...session,
            method: "PUT",
            body: { passWord: nextPassword, currentPassword: password }
          })
        ).status,
        200
      );
    if (transition === "admin-reset")
      assert.equal(
        (
          await h.request("/api/auth/?apikey=admin-api-key", {
            method: "PUT",
            body: { uuid: "player", config: { passWord: nextPassword } }
          })
        ).status,
        200
      );
    if (transition === "expiry") h.advance(86400001);
    if (transition === "eviction") for (let n = 0; n < 10; n++) await h.login();
    gate.release();
    assert.equal((await late).status, 200);
    assert.notEqual((await h.request("/api/ordinary", session)).status, 200);
    assert.equal((await h.request("/api/auth/token", session)).status, 403);
    if (["password", "admin-reset"].includes(transition))
      assert.equal((await h.login("player", nextPassword)).token.length, 64);
  });

test("stale successful login response cannot restore credentials after admin reset", async () => {
  const gate = barrier(),
    h = await startApp({ loginGate: gate });
  const login = h.request("/api/auth/login", {
    method: "POST",
    body: { username: "player", password }
  });
  await gate.entered;
  assert.equal(
    (
      await h.request("/api/auth/?apikey=admin-api-key", {
        method: "PUT",
        body: { uuid: "player", config: { passWord: nextPassword } }
      })
    ).status,
    200
  );
  gate.release();
  const late = await login;
  assert.equal(h.store.size, 0);
  assert.equal(
    (await h.request("/api/auth/token", { cookie: late.cookie, token: late.data })).status,
    403
  );
});

test("fixed TTL, constant signing keys restart, legacy payload, disabled/deleted/fingerprint users", async () => {
  const h = await startApp(),
    session = await h.login();
  h.advance(86400000 - 1000);
  assert.equal((await h.request("/api/ordinary", session)).status, 200);
  h.advance(1001);
  assert.equal((await h.request("/api/auth/token", session)).status, 403);
  const fresh = await h.login();
  await h.stop();
  const restart = await startApp();
  assert.equal((await restart.request("/api/auth/token", fresh)).status, 403);
  const legacy = Buffer.from(
    JSON.stringify({
      login: true,
      uuid: "player",
      userName: "player",
      token: "known",
      _expire: Date.now() + 86400000
    })
  ).toString("base64");
  const sig = new Keygrip(["stable-test-signing-key"]).sign("auth-test=" + legacy);
  assert.equal(
    (
      await restart.request("/api/auth/token", {
        cookie: "auth-test=" + legacy + "; auth-test.sig=" + sig,
        token: "known"
      })
    ).status,
    403
  );
  for (const mutate of [
    (user) => {
      user.permission = -1;
    },
    (user) => {
      user.passWord += "changed";
    },
    () => users.objects.delete("player")
  ]) {
    makeUser();
    const auth = await restart.login();
    mutate(users.getInstance("player"));
    assert.notEqual((await restart.request("/api/ordinary", auth)).status, 200);
    assert.equal((await restart.request("/api/auth/token", auth)).status, 403);
    assert.equal((await restart.request("/api/identity", auth)).data.found, false);
  }
});

test("empty requests allocate no entries, global/per-user bounds preserve unrelated sessions", async () => {
  const h = await startApp({ limits: { total: 2, anonymous: 1, perUser: 1, bytes: 32768 } });
  await h.request("/api/plain");
  assert.equal(h.store.size, 0);
  const first = await h.login(),
    second = await h.login();
  assert.equal(h.store.size, 1);
  assert.equal((await h.request("/api/auth/token", first)).status, 403);
  assert.equal((await h.request("/api/auth/token", second)).status, 200);
  await h.login("admin");
  const denied = await h.request("/api/auth/sso/authorize");
  assert.equal(denied.status, 503);
  assert.equal((await h.request("/api/auth/token", second)).status, 200);
});

test("ordinary API keys work; sensitive APIs reject query/header keys with or without cookies", async () => {
  const h = await startApp(),
    session = await h.login();
  assert.equal((await h.request("/api/ordinary?apikey=player-api-key")).status, 200);
  assert.equal(
    (await h.request("/api/ordinary", { headers: { "x-request-api-key": "player-api-key" } }))
      .status,
    200
  );
  assert.equal((await h.request("/api/ordinary?apikey=bad")).status, 403);
  assert.equal((await h.request("/api/admin-only?apikey=player-api-key")).status, 403);
  for (const auth of [{}, session])
    for (const carrier of ["query", "header"]) {
      const response = await h.request(
        "/api/auth/bind2fa" + (carrier === "query" ? "?apikey=player-api-key" : ""),
        {
          ...auth,
          method: "POST",
          body: { currentPassword: password },
          headers: carrier === "header" ? { "x-request-api-key": "player-api-key" } : {}
        }
      );
      assert.equal(response.status, 403);
    }
  assert.equal(qrUris.length, 0);
  assert.equal(
    (
      await h.request("/api/auth/api", {
        ...session,
        method: "PUT",
        body: { enable: false, currentPassword: password }
      })
    ).data,
    ""
  );
  assert.equal((await h.request("/api/ordinary?apikey=player-api-key")).status, 403);
});

test("password proof, bcrypt/legacy MD5, self factor preservation and admin recovery", async () => {
  const secret = authenticator.generateSecret();
  makeUser("player", 1, { open2FA: true, secret });
  const h = await startApp(),
    session = await h.login("player", password, code(secret));
  for (const body of [
    { passWord: nextPassword },
    { passWord: nextPassword, currentPassword: "wrong", currentTOTP: code(secret) },
    { passWord: nextPassword, currentPassword: password }
  ])
    assert.equal(
      (await h.request("/api/auth/update", { ...session, method: "PUT", body })).status,
      403
    );
  assert.equal(
    (
      await h.request("/api/auth/update", {
        ...session,
        method: "PUT",
        body: { passWord: nextPassword, currentPassword: password, currentTOTP: code(secret) }
      })
    ).status,
    200
  );
  assert.equal(users.getInstance("player").secret, secret);
  assert.equal(users.getInstance("player").open2FA, true);
  assert.equal((await h.request("/api/ordinary?apikey=player-api-key")).status, 200);
  const after = await h.login("player", nextPassword, code(secret));
  assert.equal(
    (
      await h.request("/api/auth/?apikey=admin-api-key", {
        method: "PUT",
        body: { uuid: "player", config: { passWord: password } }
      })
    ).status,
    200
  );
  assert.equal(users.getInstance("player").open2FA, false);
  assert.equal(users.getInstance("player").secret, "");
  assert.equal((await h.request("/api/auth/token", after)).status, 403);
  makeUser("legacy", 1, { passWordType: 0, passWord: md5("old") });
  const legacy = await h.login("legacy", "old");
  assert.equal(
    (
      await h.request("/api/auth/update", {
        ...legacy,
        method: "PUT",
        body: { currentPassword: "old", passWord: nextPassword }
      })
    ).status,
    200
  );
  assert.equal(users.getInstance("legacy").passWordType, 1);
});

test("wrong new TOTP and definite storage failure preserve SAME cookie/setup for retry", async () => {
  const old = authenticator.generateSecret();
  makeUser("player", 1, { open2FA: true, secret: old });
  const h = await startApp(),
    session = await h.login("player", password, code(old));
  const start = await h.request("/api/auth/bind2fa", {
    ...session,
    method: "POST",
    body: { currentPassword: password, currentTOTP: code(old) }
  });
  assert.equal(start.status, 200, start.text);
  assert.equal(start.data.replacing, true);
  assert.equal(start.headers["cache-control"], "no-store");
  const secret = stagedSecret();
  assert.match(start.data.qrcode, /^data:image\/png;base64,/);
  assert.equal(users.getInstance("player").secret, old);
  assert.equal(users.getInstance("player").open2FA, true);
  assert.doesNotThrow(() => users.checkUser({ userName: "player", passWord: password }, code(old)));
  const confirm = (TOTPCode) =>
    h.request("/api/auth/confirm2fa", {
      ...session,
      method: "POST",
      body: { enable: true, setupId: start.data.setupId, TOTPCode }
    });
  assert.equal((await confirm(badCode(secret))).status, 403);
  assert.equal((await h.request("/api/auth/token", session)).status, 200);
  failure = "definite";
  assert.equal((await confirm(code(secret))).status, 503);
  assert.equal(users.getInstance("player").secret, old);
  assert.equal(disk.get("player").secret, old);
  failure = undefined;
  const committed = await confirm(code(secret));
  assert.equal(committed.status, 200, committed.text);
  assert.deepEqual(committed.data, { enabled: true, reloginRequired: true });
  assert.equal(users.getInstance("player").secret, secret);
  assert.equal(users.getInstance("player").open2FA, true);
  assert.equal((await h.request("/api/auth/token", session)).status, 403);
  assert.equal(
    (
      await h.request("/api/auth/login", {
        method: "POST",
        body: { username: "player", password, code: code(old) }
      })
    ).status,
    500
  );
  await h.login("player", password, code(secret));
  const log = JSON.stringify(logs);
  for (const value of [secret, old, session.token, password])
    assert.equal(log.includes(value), false);
});

test("five wrong current-proof attempts keep session alive; sixth returns 429", async () => {
  const h = await startApp(),
    session = await h.login();
  for (let n = 0; n < 5; n++)
    assert.equal(
      (
        await h.request("/api/auth/bind2fa", {
          ...session,
          method: "POST",
          body: { currentPassword: "wrong" }
        })
      ).status,
      403
    );
  assert.equal(
    (
      await h.request("/api/auth/bind2fa", {
        ...session,
        method: "POST",
        body: { currentPassword: password }
      })
    ).status,
    429
  );
  assert.equal((await h.request("/api/auth/token", session)).status, 200);
  h.advance(300001);
  assert.equal(
    (
      await h.request("/api/auth/bind2fa", {
        ...session,
        method: "POST",
        body: { currentPassword: password }
      })
    ).status,
    200
  );
});

test("large ordinary traffic never enlarges the independent five-wrong-TOTP proof budget", async () => {
  const secret = authenticator.generateSecret();
  makeUser("player", 1, { open2FA: true, secret });
  const h = await startApp(),
    session = await h.login("player", password, code(secret));
  for (let wave = 0; wave < 4; wave++) {
    const responses = await Promise.all(
      Array.from({ length: 128 }, () => h.request("/api/ordinary", session))
    );
    assert.ok(responses.every((r) => r.status === 200));
  }
  const proof = (currentTOTP) =>
    h.request("/api/auth/bind2fa", {
      ...session,
      method: "POST",
      body: { currentPassword: password, currentTOTP }
    });
  for (let i = 0; i < 5; i++) assert.equal((await proof(badCode(secret))).status, 403);
  const denied = await proof(code(secret));
  assert.equal(denied.status, 429);
  assert.equal(denied.data, "Too many proof attempts; retry later");
  assert.equal(qrUris.length, 0);
  assert.equal((await h.request("/api/auth/token", session)).status, 200);
  h.advance(1000);
  const afterOrdinaryRefill = await proof(code(secret));
  assert.equal(afterOrdinaryRefill.status, 429);
  assert.equal(afterOrdinaryRefill.data, "Too many proof attempts; retry later");
  h.advance(300001);
  assert.equal((await proof(code(secret))).status, 200);
});

test("new-code cap, expiry, cancel and stale setup IDs preserve active factor", async () => {
  const old = authenticator.generateSecret();
  makeUser("player", 10, { open2FA: true, secret: old });
  const h = await startApp(),
    session = await h.login("player", password, code(old));
  const start = () =>
    h.request("/api/auth/bind2fa", {
      ...session,
      method: "POST",
      body: { currentPassword: password, currentTOTP: code(old) }
    });
  const confirm = (setupId, TOTPCode) =>
    h.request("/api/auth/confirm2fa", {
      ...session,
      method: "POST",
      body: { enable: true, setupId, TOTPCode }
    });
  const first = await start(),
    second = await start(),
    secret = stagedSecret();
  assert.equal((await confirm(first.data.setupId, code(secret))).status, 409);
  assert.equal(
    (
      await h.request("/api/auth/bind2fa", {
        ...session,
        method: "DELETE",
        body: { setupId: first.data.setupId }
      })
    ).status,
    409
  );
  for (let n = 0; n < 5; n++) {
    h.advance(1001);
    assert.equal((await confirm(second.data.setupId, badCode(secret))).status, 403);
  }
  assert.equal((await confirm(second.data.setupId, code(secret))).status, 429);
  const third = await start(),
    thirdSecret = stagedSecret();
  h.advance(300001);
  assert.equal((await confirm(third.data.setupId, code(thirdSecret))).status, 410);
  const fourth = await start();
  assert.equal(
    (
      await h.request("/api/auth/bind2fa", {
        ...session,
        method: "DELETE",
        body: { setupId: fourth.data.setupId }
      })
    ).status,
    200
  );
  assert.equal((await confirm(fourth.data.setupId, code(stagedSecret()))).status, 409);
  assert.equal(users.getInstance("player").secret, old);
  assert.equal(users.getInstance("player").open2FA, true);
});

test("setup is session-bound; QR errors preserve prior setup; disable needs active code", async () => {
  const old = authenticator.generateSecret();
  makeUser("player", 10, { open2FA: true, secret: old });
  const h = await startApp(),
    first = await h.login("player", password, code(old)),
    second = await h.login("player", password, code(old));
  const body = { currentPassword: password, currentTOTP: code(old) };
  const start = await h.request("/api/auth/bind2fa", { ...first, method: "POST", body }),
    secret = stagedSecret();
  const confirmation = { enable: true, setupId: start.data.setupId, TOTPCode: code(secret) };
  assert.equal(
    (await h.request("/api/auth/confirm2fa", { ...second, method: "POST", body: confirmation }))
      .status,
    409
  );
  qrFailure = true;
  assert.equal(
    (await h.request("/api/auth/bind2fa", { ...first, method: "POST", body })).status,
    503
  );
  qrFailure = false;
  assert.equal(
    (
      await h.request("/api/auth/confirm2fa", {
        ...first,
        method: "POST",
        body: { enable: false, currentPassword: password, currentTOTP: badCode(old) }
      })
    ).status,
    403
  );
  assert.equal(users.getInstance("player").secret, old);
  assert.equal(
    (await h.request("/api/auth/confirm2fa", { ...first, method: "POST", body: confirmation }))
      .status,
    200
  );
  const current = await h.login("player", password, code(secret));
  assert.equal(
    (
      await h.request("/api/auth/confirm2fa", {
        ...current,
        method: "POST",
        body: { enable: false, currentPassword: password, currentTOTP: code(secret) }
      })
    ).status,
    200
  );
  assert.equal(users.getInstance("player").secret, "");
  assert.equal(users.getInstance("player").open2FA, false);
  assert.equal((await h.request("/api/auth/token", current)).status, 403);
});

test("competing confirms commit once; queued profile/SSO writes preserve new credentials", async () => {
  makeUser("player", 10);
  const h = await startApp(),
    session = await h.login();
  const start = await h.request("/api/auth/bind2fa", {
    ...session,
    method: "POST",
    body: { currentPassword: password }
  });
  const secret = stagedSecret();
  writeGate = barrier();
  const confirm = () =>
    h.request("/api/auth/confirm2fa", {
      ...session,
      method: "POST",
      body: { enable: true, setupId: start.data.setupId, TOTPCode: code(secret) }
    });
  const first = confirm();
  await writeGate.entered;
  const second = confirm();
  const profile = users.edit("player", { theme: "nether" }),
    binding = users.bindSso("player", "bound-sub");
  writeGate.release();
  const results = await Promise.all([first, second]);
  await Promise.all([profile, binding]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(users.getInstance("player").secret, secret);
  assert.equal(disk.get("player").secret, secret);
  assert.equal(users.getInstance("player").ssoSub, "bound-sub");
  assert.equal(users.getInstance("player").theme, "nether");
});

for (const outcome of ["ambiguous-before", "ambiguous-after"])
  test(outcome + " quarantines until authoritative reload", async () => {
    const h = await startApp(),
      session = await h.login();
    failure = outcome;
    const response = await h.request("/api/auth/update", {
      ...session,
      method: "PUT",
      body: { currentPassword: password, passWord: nextPassword }
    });
    assert.equal(response.status, 503);
    assert.equal(users.getInstance("player"), undefined);
    assert.equal((await h.request("/api/auth/token", session)).status, 403);
    failure = undefined;
    reloadFailure = true;
    await assert.rejects(users.edit("player", { theme: "nether" }));
    assert.equal(users.getInstance("player"), undefined);
    reloadFailure = false;
    await users.edit("player", { theme: "nether" });
    assert.ok(
      bcrypt.compareSync(
        outcome === "ambiguous-after" ? nextPassword : password,
        users.getInstance("player").passWord
      )
    );
    assert.equal((await h.request("/api/auth/token", session)).status, 403);
  });

test("actual atomic User files survive write/rename errors; reload ignores temporary records", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nexcraft-auth-")),
    oldPath = StorageSubsystem.DATA_PATH;
  const extra = dep("fs-extra"),
    originalWrite = extra.writeFile,
    originalRename = extra.rename;
  try {
    StorageSubsystem.DATA_PATH = temp;
    const user = users.getInstance("player");
    await realFileStore.store("User", user.uuid, user);
    const changed = { ...user, secret: "replacement", open2FA: true };
    extra.writeFile = async () => {
      throw new Error("ENOSPC");
    };
    await assert.rejects(
      realFileStore.store("User", user.uuid, changed),
      (error) => error instanceof UserWriteError && error.definite
    );
    extra.writeFile = originalWrite;
    extra.rename = async () => {
      throw new Error("EACCES");
    };
    await assert.rejects(
      realFileStore.store("User", user.uuid, changed),
      (error) => error instanceof UserWriteError && error.definite
    );
    assert.equal((await realFileStore.load("User", User, user.uuid)).secret, "");
    extra.rename = originalRename;
    await realFileStore.store("User", user.uuid, changed);
    fs.writeFileSync(path.join(temp, "User", "orphan.tmp"), "partial");
    assert.deepEqual(await realFileStore.list("User"), ["player"]);
    assert.equal((await realFileStore.load("User", User, user.uuid)).open2FA, true);
  } finally {
    extra.writeFile = originalWrite;
    extra.rename = originalRename;
    StorageSubsystem.DATA_PATH = oldPath;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("verified SSO callback permits enrollment; expired/ordinary/forged/exchange proof fail", async () => {
  settings.systemConfig.ssoEnabled = true;
  makeUser("player", 10, { ssoBound: true, ssoSub: "provider-user" });
  const h = await startApp();
  const authorize = await h.request("/api/auth/sso/authorize"),
    state = new URL(authorize.headers.location).searchParams.get("state");
  const callback = await h.request(
    "/api/auth/sso/callback?state=" + state + "&code=provider-user",
    { cookie: authorize.cookie }
  );
  assert.equal(callback.status, 302, callback.text);
  assert.notEqual(callback.cookie, authorize.cookie);
  const token = await h.request("/api/auth/token", { cookie: callback.cookie }),
    session = { cookie: callback.cookie, token: token.data };
  const start = await h.request("/api/auth/bind2fa", { ...session, method: "POST", body: {} });
  assert.equal(start.status, 200, start.text);
  h.advance(300001);
  assert.equal(
    (await h.request("/api/auth/bind2fa", { ...session, method: "POST", body: {} })).status,
    403
  );
  const ordinary = await h.login();
  assert.equal(
    (await h.request("/api/auth/bind2fa", { ...ordinary, method: "POST", body: {} })).status,
    403
  );
  assert.equal(
    (
      await h.request("/api/auth/bind2fa", {
        ...ordinary,
        method: "POST",
        body: { providerAt: Date.now() }
      })
    ).status,
    400
  );
  const exchange = exchangeTokens.generateSSOToken("player");
  const exchangeLogin = await h.request(
    "/api/exchange/sso?username=player&token=" +
      exchange +
      "&origin=https%3A%2F%2Fpanel.example&instanceId=test&daemonId=node"
  );
  const exchangeToken = await h.request("/api/auth/token", { cookie: exchangeLogin.cookie });
  assert.equal(
    (
      await h.request("/api/auth/bind2fa", {
        cookie: exchangeLogin.cookie,
        token: exchangeToken.data,
        method: "POST",
        body: {}
      })
    ).status,
    403
  );
  const log = JSON.stringify(logs);
  assert.equal(log.includes(exchange), false);
  assert.equal(log.includes(session.token), false);
});

test("overlapping SSO callbacks consume state before provider await; stale saves cannot restore it", async () => {
  settings.systemConfig.ssoEnabled = true;
  makeUser("player", 10, { ssoBound: true, ssoSub: "provider-user" });
  const staleGate = barrier(),
    h = await startApp({ protectedGate: staleGate });
  const authorize = await h.request("/api/auth/sso/authorize"),
    state = new URL(authorize.headers.location).searchParams.get("state");
  const stale = h.request("/api/deferred-protected", { cookie: authorize.cookie });
  await staleGate.entered;
  providerGate = barrier();
  const callback = h.request("/api/auth/sso/callback?state=" + state + "&code=provider-user", {
    cookie: authorize.cookie
  });
  await providerGate.entered;
  const duplicate = await h.request(
    "/api/auth/sso/callback?state=" + state + "&code=provider-user",
    { cookie: authorize.cookie }
  );
  assert.equal(duplicate.status, 302);
  assert.match(duplicate.headers.location, /invalid_sso_session/);
  assert.equal(providerCalls, 1);
  providerGate.release();
  const complete = await callback;
  assert.equal(complete.status, 302);
  staleGate.release();
  assert.equal((await stale).status, 409);
  assert.equal((await h.request("/api/auth/token", { cookie: authorize.cookie })).status, 403);
});

test("SSO binding retains verified provenance and bind-current rejects API keys", async () => {
  settings.systemConfig.ssoEnabled = true;
  const h = await startApp();
  const authorize = await h.request("/api/auth/sso/authorize"),
    state = new URL(authorize.headers.location).searchParams.get("state");
  const callback = await h.request("/api/auth/sso/callback?state=" + state + "&code=new-provider", {
    cookie: authorize.cookie
  });
  assert.match(callback.headers.location, /sso\/bind/);
  const bind = await h.request("/api/auth/sso/bind", {
    cookie: callback.cookie || authorize.cookie,
    method: "POST",
    body: { username: "player", password }
  });
  assert.equal(bind.status, 200, bind.text);
  const session = { cookie: bind.cookie, token: bind.data };
  assert.equal(users.getInstance("player").ssoSub, "new-provider");
  assert.equal(
    (await h.request("/api/auth/bind2fa", { ...session, method: "POST", body: {} })).status,
    200
  );
  assert.equal(
    (
      await h.request("/api/auth/sso/bind-current?apikey=player-api-key", {
        ...session,
        method: "POST",
        body: {}
      })
    ).status,
    403
  );
});

test("final store commit failure returns typed HTTP envelope and no usable issued cookie", async () => {
  const h = await startApp(),
    original = h.store.set.bind(h.store);
  h.store.set = async (...args) => {
    await original(...args);
    throw new SessionError(503, "Session persistence unavailable");
  };
  const response = await h.request("/api/auth/login", {
    method: "POST",
    body: { username: "player", password }
  });
  assert.equal(response.status, 503);
  assert.equal(JSON.parse(response.text).status, 503);
  assert.equal(h.store.size, 0);
  h.store.set = original;
  assert.equal((await h.request("/api/auth/token", { cookie: response.cookie })).status, 403);
});

test("anonymous capacity, oversized payloads and JSON identity fields cannot mint authentication", async () => {
  const h = await startApp({ limits: { total: 3, anonymous: 1, perUser: 2, bytes: 32768 } });
  assert.equal((await h.request("/api/forged")).status, 403);
  assert.equal(h.store.size, 0);
  assert.equal((await h.request("/api/oversize")).status, 503);
  assert.equal(h.store.size, 0);
  settings.systemConfig.ssoEnabled = true;
  const first = await h.request("/api/auth/sso/authorize");
  assert.equal(first.status, 302);
  assert.equal((await h.request("/api/auth/sso/authorize")).status, 503);
  assert.equal(h.store.size, 1);
  h.advance(600001);
  assert.equal(h.store.size, 0);
});

test("stale protected writes reject even after protected state returns to the same JSON", async () => {
  const gate = barrier(),
    h = await startApp({ protectedGate: gate }),
    session = await h.login();
  assert.equal((await h.request("/api/protected-step?value=original", session)).status, 200);
  const stale = h.request("/api/deferred-protected", session);
  await gate.entered;
  assert.equal((await h.request("/api/protected-step?value=temporary", session)).status, 200);
  assert.equal((await h.request("/api/protected-step?value=original", session)).status, 200);
  gate.release();
  assert.equal((await stale).status, 409);
});

test("revoked admin cookie fails upload precheck before multipart parsing", async () => {
  const h = await startApp(),
    session = await h.login("admin");
  const boundary = "test-boundary";
  const upload = (auth) =>
    h.request("/api/plain", {
      ...auth,
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=" + boundary },
      body: {}
    });
  // Malformed multipart reaches the parser only for an authorized admin.
  await h.request("/api/auth/logout", session);
  const denied = await upload(session);
  assert.equal(denied.status, 500);
  assert.equal(denied.text, "Internal Server Error");
  assert.equal((await h.request("/api/identity", session)).data.found, false);
});

test("definite password persistence failure permits same-cookie retry and never changes live-only hash", async () => {
  const h = await startApp(),
    session = await h.login(),
    before = users.getInstance("player").passWord;
  const change = () =>
    h.request("/api/auth/update", {
      ...session,
      method: "PUT",
      body: { currentPassword: password, passWord: nextPassword }
    });
  failure = "definite";
  assert.equal((await change()).status, 503);
  assert.equal(users.getInstance("player").passWord, before);
  assert.equal(disk.get("player").passWord, before);
  assert.equal((await h.request("/api/auth/token", session)).status, 200);
  failure = undefined;
  assert.equal((await change()).status, 200);
  await h.login("player", nextPassword);
});

test("ambiguous factor acknowledgement quarantines, reloads committed factor and revokes old setup", async () => {
  const h = await startApp(),
    session = await h.login();
  const start = await h.request("/api/auth/bind2fa", {
      ...session,
      method: "POST",
      body: { currentPassword: password }
    }),
    secret = stagedSecret();
  failure = "ambiguous-after";
  assert.equal(
    (
      await h.request("/api/auth/confirm2fa", {
        ...session,
        method: "POST",
        body: { enable: true, setupId: start.data.setupId, TOTPCode: code(secret) }
      })
    ).status,
    503
  );
  assert.equal(users.getInstance("player"), undefined);
  failure = undefined;
  await users.edit("player", { theme: "nether" });
  assert.equal(users.getInstance("player").secret, secret);
  assert.equal(users.getInstance("player").open2FA, true);
  assert.equal((await h.request("/api/auth/token", session)).status, 403);
  await h.login("player", password, code(secret));
});

for (const transition of ["logout", "password", "admin-reset", "cancel", "disable"])
  test("staged factor cannot resurrect after " + transition, async () => {
    const old = authenticator.generateSecret();
    makeUser("player", 10, { open2FA: true, secret: old });
    const h = await startApp(),
      session = await h.login("player", password, code(old));
    const start = await h.request("/api/auth/bind2fa", {
        ...session,
        method: "POST",
        body: { currentPassword: password, currentTOTP: code(old) }
      }),
      secret = stagedSecret();
    if (transition === "logout") await h.request("/api/auth/logout", session);
    if (transition === "password")
      await h.request("/api/auth/update", {
        ...session,
        method: "PUT",
        body: { currentPassword: password, currentTOTP: code(old), passWord: nextPassword }
      });
    if (transition === "admin-reset")
      await h.request("/api/auth/?apikey=admin-api-key", {
        method: "PUT",
        body: { uuid: "player", config: { passWord: nextPassword } }
      });
    if (transition === "cancel")
      await h.request("/api/auth/bind2fa", {
        ...session,
        method: "DELETE",
        body: { setupId: start.data.setupId }
      });
    if (transition === "disable")
      await h.request("/api/auth/confirm2fa", {
        ...session,
        method: "POST",
        body: { enable: false, currentPassword: password, currentTOTP: code(old) }
      });
    const stale = await h.request("/api/auth/confirm2fa", {
      ...session,
      method: "POST",
      body: { enable: true, setupId: start.data.setupId, TOTPCode: code(secret) }
    });
    assert.ok([403, 409].includes(stale.status), stale.text);
    assert.equal(
      users.getInstance("player").secret,
      ["admin-reset", "disable"].includes(transition) ? "" : old
    );
  });

test("disable racing confirmation cannot resurrect a staged secret", async () => {
  const old = authenticator.generateSecret();
  makeUser("player", 10, { open2FA: true, secret: old });
  const h = await startApp(),
    session = await h.login("player", password, code(old));
  const start = await h.request("/api/auth/bind2fa", {
      ...session,
      method: "POST",
      body: { currentPassword: password, currentTOTP: code(old) }
    }),
    secret = stagedSecret();
  writeGate = barrier();
  const disable = h.request("/api/auth/confirm2fa", {
    ...session,
    method: "POST",
    body: { enable: false, currentPassword: password, currentTOTP: code(old) }
  });
  await writeGate.entered;
  const confirm = h.request("/api/auth/confirm2fa", {
    ...session,
    method: "POST",
    body: { enable: true, setupId: start.data.setupId, TOTPCode: code(secret) }
  });
  writeGate.release();
  assert.equal((await disable).status, 200);
  assert.ok([403, 409].includes((await confirm).status));
  assert.equal(users.getInstance("player").secret, "");
  assert.equal(disk.get("player").open2FA, false);
});

test("SSO-only policy, OAuth2 provenance, expiry/state checks and active factor step-up", async () => {
  settings.systemConfig.ssoEnabled = true;
  settings.systemConfig.ssoOnlyMode = true;
  settings.systemConfig.ssoType = "oauth2";
  const secret = authenticator.generateSecret();
  makeUser("player", 10, { ssoBound: true, ssoSub: "provider-user", open2FA: true, secret });
  const h = await startApp();
  assert.equal(
    (await h.request("/api/auth/login", { method: "POST", body: { username: "player", password } }))
      .status,
    500
  );
  const authorize = await h.request("/api/auth/sso/authorize"),
    state = new URL(authorize.headers.location).searchParams.get("state");
  const bad = await h.request("/api/auth/sso/callback?state=wrong&code=provider-user", {
    cookie: authorize.cookie
  });
  assert.match(bad.headers.location, /sso_error/);
  assert.equal(providerCalls, 0);
  const again = await h.request("/api/auth/sso/authorize"),
    newState = new URL(again.headers.location).searchParams.get("state");
  const callback = await h.request(
    "/api/auth/sso/callback?state=" + newState + "&code=provider-user",
    { cookie: again.cookie }
  );
  const token = await h.request("/api/auth/token", { cookie: callback.cookie }),
    session = { cookie: callback.cookie, token: token.data };
  assert.equal(
    (await h.request("/api/auth/bind2fa", { ...session, method: "POST", body: {} })).status,
    403
  );
  assert.equal(
    (await h.request("/api/auth/api", { ...session, method: "PUT", body: { enable: true } }))
      .status,
    403
  );
  assert.equal(
    (
      await h.request("/api/auth/api", {
        ...session,
        method: "PUT",
        body: { enable: true, currentTOTP: code(secret) }
      })
    ).status,
    200
  );
  assert.equal(
    (
      await h.request("/api/auth/update", {
        ...session,
        method: "PUT",
        body: { passWord: nextPassword, currentTOTP: code(secret) }
      })
    ).status,
    403
  );
  assert.equal(
    (
      await h.request("/api/auth/bind2fa", {
        ...session,
        method: "POST",
        body: { currentTOTP: code(secret) }
      })
    ).status,
    200
  );
  const timed = await h.request("/api/auth/sso/authorize"),
    timedState = new URL(timed.headers.location).searchParams.get("state");
  h.advance(600001);
  assert.ok(
    [302, 403].includes(
      (
        await h.request("/api/auth/sso/callback?state=" + timedState + "&code=provider-user", {
          cookie: timed.cookie
        })
      ).status
    )
  );
});

test("strict proof shapes and missing-factor secret fail closed without changing global TOTP options", async () => {
  const h = await startApp(),
    session = await h.login(),
    beforeOptions = { ...authenticator.options };
  for (const body of [
    { currentPassword: 123 },
    { currentPassword: [] },
    { currentTOTP: 123456 },
    { currentTOTP: "12345" },
    { currentPassword: "x".repeat(257) },
    { extra: true }
  ])
    assert.equal(
      (await h.request("/api/auth/bind2fa", { ...session, method: "POST", body })).status,
      400
    );
  h.advance(1001);
  users.getInstance("player").open2FA = true;
  users.getInstance("player").secret = "";
  assert.equal(
    (
      await h.request("/api/auth/bind2fa", {
        ...session,
        method: "POST",
        body: { currentPassword: password, currentTOTP: "123456" }
      })
    ).status,
    403
  );
  assert.deepEqual(authenticator.options, beforeOptions);
  const unknown = await h.request("/api/auth/login", {
    method: "POST",
    body: { username: "unknown", password }
  });
  assert.equal(unknown.status, 500);
});

test("Redis rejected SET quarantines; recovery reads the original Redis backend", async () => {
  const redis = src("common/storage/redis_storage.ts").default,
    originalClient = redis.client;
  const record = new Map([["User:player", JSON.stringify(users.getInstance("player"))]]);
  let rejectWrite = true;
  redis.client = {
    async set(key, value) {
      if (rejectWrite) throw new Error("Redis disconnected");
      record.set(key, value);
    },
    async get(key) {
      return record.get(key);
    }
  };
  storage.getStorage = () => redis;
  try {
    const h = await startApp(),
      session = await h.login();
    assert.equal(
      (
        await h.request("/api/auth/update", {
          ...session,
          method: "PUT",
          body: { currentPassword: password, passWord: nextPassword }
        })
      ).status,
      503
    );
    assert.equal(users.getInstance("player"), undefined);
    rejectWrite = false;
    // Even if the global selector changed, authoritative recovery must use the pinned failed backend.
    storage.getStorage = () => backend;
    await users.edit("player", { theme: "nether" });
    assert.equal(JSON.parse(record.get("User:player")).theme, "nether");
    assert.equal(writeCount, 0, "recovery must not switch backends to claim success");
    assert.ok(bcrypt.compareSync(password, users.getInstance("player").passWord));
    assert.equal((await h.request("/api/auth/token", session)).status, 403);
  } finally {
    redis.client = originalClient;
    storage.getStorage = () => backend;
  }
});

test("SSO rotates its own anonymous entry even at global capacity", async () => {
  settings.systemConfig.ssoEnabled = true;
  makeUser("player", 10, { ssoBound: true, ssoSub: "provider-user" });
  const h = await startApp({ limits: { total: 2, anonymous: 1, perUser: 10, bytes: 32768 } });
  const existing = await h.login();
  const authorize = await h.request("/api/auth/sso/authorize"),
    state = new URL(authorize.headers.location).searchParams.get("state");
  assert.equal(h.store.size, 2);
  const callback = await h.request(
    "/api/auth/sso/callback?state=" + state + "&code=provider-user",
    { cookie: authorize.cookie }
  );
  assert.equal(callback.headers.location, "/#/sso/callback");
  assert.notEqual(callback.cookie, authorize.cookie);
  assert.equal(h.store.size, 2);
  assert.equal((await h.request("/api/auth/token", existing)).status, 200);
  assert.equal((await h.request("/api/auth/token", { cookie: callback.cookie })).status, 200);
});

test("factor A to B to A cannot revive a previously issued cookie", async () => {
  const secret = authenticator.generateSecret();
  makeUser("player", 1, { open2FA: true, secret });
  const h = await startApp(),
    session = await h.login("player", password, code(secret));
  await users.edit("player", { secret: authenticator.generateSecret() });
  await users.edit("player", { secret });
  assert.equal((await h.request("/api/auth/token", session)).status, 403);
  await h.login("player", password, code(secret));
});

test("interactive bind-current rotates/revokes sessions without manufacturing recent-provider proof", async () => {
  settings.systemConfig.ssoEnabled = true;
  const h = await startApp(),
    original = await h.login();
  const authorize = await h.request("/api/auth/sso/authorize", original),
    state = new URL(authorize.headers.location).searchParams.get("state");
  const callback = await h.request(
    "/api/auth/sso/callback?state=" + state + "&code=current-binding",
    original
  );
  assert.equal(callback.headers.location, "/#/sso/bind");
  const bound = await h.request("/api/auth/sso/bind-current", {
    ...original,
    method: "POST",
    body: {}
  });
  assert.equal(bound.status, 200, bound.text);
  assert.equal(bound.data, true);
  assert.notEqual(bound.cookie, original.cookie);
  assert.equal((await h.request("/api/auth/token", original)).status, 403);
  const token = await h.request("/api/auth/token", { cookie: bound.cookie }),
    session = { cookie: bound.cookie, token: token.data };
  assert.notEqual(token.data, original.token);
  assert.equal(users.getInstance("player").ssoSub, "current-binding");
  assert.equal(
    (await h.request("/api/auth/bind2fa", { ...session, method: "POST", body: {} })).status,
    403
  );
  await h.request("/api/auth/logout", session);
  assert.equal((await h.request("/api/auth/token", session)).status, 403);
});

test("ordinary stale save preserves newly consumed SSO state and pending binding", async () => {
  settings.systemConfig.ssoEnabled = true;
  const gate = barrier(),
    h = await startApp({ deferredGate: gate }),
    session = await h.login();
  const authorize = await h.request("/api/auth/sso/authorize", session),
    state = new URL(authorize.headers.location).searchParams.get("state");
  const late = h.request("/api/deferred", session);
  await gate.entered;
  const callback = await h.request(
    "/api/auth/sso/callback?state=" + state + "&code=ordinary-overlap",
    session
  );
  assert.equal(callback.headers.location, "/#/sso/bind");
  gate.release();
  assert.equal((await late).status, 200);
  const replay = await h.request(
    "/api/auth/sso/callback?state=" + state + "&code=ordinary-overlap",
    session
  );
  assert.match(replay.headers.location, /invalid_sso_session/);
  assert.equal(providerCalls, 1);
  const bind = await h.request("/api/auth/sso/bind-current", {
    ...session,
    method: "POST",
    body: {}
  });
  assert.equal(bind.status, 200, bind.text);
  assert.equal(users.getInstance("player").ssoSub, "ordinary-overlap");
});

test("stateless ordinary API clients do not consume anonymous browser capacity", async () => {
  const h = await startApp({ limits: { total: 1, anonymous: 0, perUser: 1, bytes: 32768 } });
  for (let n = 0; n < 12; n++) {
    const response = await h.request("/api/ordinary?apikey=player-api-key");
    assert.equal(response.status, 200, response.text);
    assert.equal(response.cookie, "");
    assert.equal(h.store.size, 0);
  }
  assert.equal((await h.login()).token.length, 64);
});

for (const outcome of ["before", "after"])
  test(
    "sole admin recovers through HTTP login after ambiguous Redis " + outcome + " write",
    async () => {
      users.objects.clear();
      disk.clear();
      makeUser("admin", 10);
      const redis = src("common/storage/redis_storage.ts").default,
        originalClient = redis.client;
      let unavailable = false,
        ambiguous = true;
      let committed = JSON.stringify(users.getInstance("admin"));
      redis.client = {
        async set(_key, value) {
          if (ambiguous && outcome === "before") throw new Error("Redis acknowledgement lost");
          committed = value;
          if (ambiguous) throw new Error("Redis acknowledgement lost");
        },
        async get() {
          if (unavailable) throw new Error("Redis still unavailable");
          return committed;
        }
      };
      storage.getStorage = () => redis;
      try {
        const h = await startApp(),
          original = await h.login("admin");
        const failed = await h.request("/api/auth/update", {
          ...original,
          method: "PUT",
          body: { currentPassword: password, passWord: nextPassword }
        });
        assert.equal(failed.status, 503);
        assert.equal(users.getInstance("admin"), undefined);
        unavailable = true;
        const blocked = await h.request("/api/auth/login", {
          method: "POST",
          body: { username: "admin", password: outcome === "after" ? nextPassword : password }
        });
        assert.equal(blocked.status, 503);
        assert.equal(users.getInstance("admin"), undefined);
        unavailable = false;
        ambiguous = false;
        const wrong = await h.request("/api/auth/login", {
          method: "POST",
          body: { username: "admin", password: outcome === "after" ? password : nextPassword }
        });
        assert.equal(wrong.status, 500);
        assert.notEqual(
          (await h.request("/api/admin-only", { cookie: wrong.cookie, token: wrong.data })).status,
          200
        );
        const recovered = await h.login("admin", outcome === "after" ? nextPassword : password);
        assert.equal((await h.request("/api/admin-only", recovered)).status, 200);
        assert.equal((await h.request("/api/auth/token", original)).status, 403);
        assert.equal(users.objects.size, 1);
      } finally {
        redis.client = originalClient;
        storage.getStorage = () => backend;
      }
    }
  );

test("verified SSO login recovers quarantined SSO-only administrator through HTTP", async () => {
  users.objects.clear();
  disk.clear();
  makeUser("admin", 10, { ssoBound: true, ssoSub: "only-admin" });
  settings.systemConfig.ssoEnabled = true;
  settings.systemConfig.ssoOnlyMode = true;
  const h = await startApp();
  failure = "ambiguous-after";
  assert.equal(
    (
      await h.request("/api/auth/?apikey=admin-api-key", {
        method: "PUT",
        body: { uuid: "admin", config: { passWord: nextPassword } }
      })
    ).status,
    503
  );
  assert.equal(users.getInstance("admin"), undefined);
  failure = undefined;
  const authorize = await h.request("/api/auth/sso/authorize"),
    state = new URL(authorize.headers.location).searchParams.get("state");
  const callback = await h.request("/api/auth/sso/callback?state=" + state + "&code=only-admin", {
    cookie: authorize.cookie
  });
  assert.equal(callback.headers.location, "/#/sso/callback");
  const token = await h.request("/api/auth/token", { cookie: callback.cookie });
  assert.equal(
    (await h.request("/api/admin-only", { cookie: callback.cookie, token: token.data })).status,
    200
  );
  assert.equal(users.getInstance("admin").ssoSub, "only-admin");
  assert.equal(users.objects.size, 1);
});

for (const outcome of ["before", "after"])
  test(
    "HTTP DELETE quarantines a lost Redis DEL acknowledgement " + outcome + " commit",
    async () => {
      const redis = src("common/storage/redis_storage.ts").default,
        originalClient = redis.client;
      let unavailable = true,
        reads = 0;
      redis.client = {
        async del(key) {
          if (outcome === "after") disk.delete(key.slice("User:".length));
          throw new Error("Redis DEL acknowledgement lost");
        },
        async get(key) {
          reads++;
          if (unavailable) throw new Error("Redis unavailable");
          const value = disk.get(key.slice("User:".length));
          return value ? JSON.stringify(value) : null;
        }
      };
      storage.getStorage = () => redis;
      try {
        const h = await startApp(),
          old = await h.login();
        const start = await h.request("/api/auth/bind2fa", {
            ...old,
            method: "POST",
            body: { currentPassword: password }
          }),
          secret = stagedSecret();
        const deleted = await h.request("/api/auth/?apikey=admin-api-key", {
          method: "DELETE",
          body: ["player"]
        });
        assert.equal(deleted.status, 503, deleted.text);
        assert.equal(JSON.parse(deleted.text).status, 503);
        assert.equal(typeof deleted.data, "string");
        assert.equal(disk.has("player"), outcome === "before");
        assert.equal(users.getInstance("player"), undefined);
        assert.equal((await h.request("/api/auth/token", old)).status, 403);
        assert.equal((await h.request("/api/ordinary?apikey=player-api-key")).status, 403);
        // A changed global backend must never satisfy recovery with a stale record.
        storage.getStorage = () => backend;
        const login = () =>
          h.request("/api/auth/login", {
            method: "POST",
            body: { username: "player", password }
          });
        assert.equal((await login()).status, 503);
        assert.ok(reads > 0);
        assert.equal(users.getInstance("player"), undefined);
        unavailable = false;
        const recovered = await login();
        if (outcome === "after") {
          assert.equal(recovered.status, 403, recovered.text);
          assert.equal(users.objects.has("player"), false);
          assert.equal(users.hasInstance("player"), false);
          const retry = await login();
          assert.notEqual(retry.status, 200);
          assert.equal(
            (
              await h.request("/api/ordinary", {
                cookie: retry.cookie,
                token: retry.data
              })
            ).status,
            403
          );
          assert.equal((await h.request("/api/ordinary?apikey=player-api-key")).status, 403);
          assert.equal(
            (
              await h.request("/api/ordinary", {
                headers: { "x-request-api-key": "player-api-key" }
              })
            ).status,
            403
          );
        } else {
          assert.equal(recovered.status, 200, recovered.text);
          const fresh = { cookie: recovered.cookie, token: recovered.data };
          assert.equal((await h.request("/api/ordinary", fresh)).status, 200);
          assert.equal(
            (
              await h.request("/api/auth/confirm2fa", {
                ...fresh,
                method: "POST",
                body: { enable: true, setupId: start.data.setupId, TOTPCode: code(secret) }
              })
            ).status,
            409
          );
          assert.equal(users.getInstance("player").open2FA, false);
        }
        assert.equal((await h.request("/api/auth/token", old)).status, 403);
        assert.equal(
          (
            await h.request("/api/auth/confirm2fa", {
              ...old,
              method: "POST",
              body: { enable: true, setupId: start.data.setupId, TOTPCode: code(secret) }
            })
          ).status,
          403
        );
      } finally {
        redis.client = originalClient;
        storage.getStorage = () => backend;
      }
    }
  );

test("definite HTTP DELETE failure retains committed account but revokes sessions and setup", async () => {
  const originalDelete = backend.delete;
  backend.delete = async () => {
    throw new UserWriteError(true);
  };
  try {
    const h = await startApp(),
      old = await h.login();
    const start = await h.request("/api/auth/bind2fa", {
        ...old,
        method: "POST",
        body: { currentPassword: password }
      }),
      secret = stagedSecret();
    const deleted = await h.request("/api/auth/?apikey=admin-api-key", {
      method: "DELETE",
      body: ["player"]
    });
    assert.equal(deleted.status, 503);
    assert.equal(JSON.parse(deleted.text).status, 503);
    assert.ok(disk.has("player"));
    assert.ok(users.getInstance("player"));
    assert.equal((await h.request("/api/auth/token", old)).status, 403);
    const fresh = await h.login();
    assert.equal((await h.request("/api/ordinary", fresh)).status, 200);
    assert.equal((await h.request("/api/ordinary?apikey=player-api-key")).status, 200);
    assert.equal(
      (
        await h.request("/api/auth/confirm2fa", {
          ...fresh,
          method: "POST",
          body: { enable: true, setupId: start.data.setupId, TOTPCode: code(secret) }
        })
      ).status,
      409
    );
    assert.equal(users.getInstance("player").open2FA, false);
  } finally {
    backend.delete = originalDelete;
  }
});

for (const write of ["theme", "password", "confirm", "confirm-definite-failure"])
  test(
    "logout completes before held " + write + " persistence and cannot resurrect its cookie",
    { timeout: 10000 },
    async (t) => {
      const h = await startApp(),
        old = await h.login();
      const start = await h.request("/api/auth/bind2fa", {
          ...old,
          method: "POST",
          body: { currentPassword: password }
        }),
        secret = stagedSecret(),
        other = await h.login();
      const gate = barrier();
      writeGate = gate;
      if (write === "confirm-definite-failure") failure = "definite";
      const request =
        write === "theme"
          ? { route: "/api/auth/theme", method: "PUT", body: { theme: "nether" } }
          : write === "password"
          ? {
              route: "/api/auth/update",
              method: "PUT",
              body: { currentPassword: password, passWord: nextPassword }
            }
          : {
              route: "/api/auth/confirm2fa",
              method: "POST",
              body: { enable: true, setupId: start.data.setupId, TOTPCode: code(secret) }
            };
      const writing = h.request(request.route, {
        ...old,
        method: request.method,
        body: request.body
      });
      await gate.entered;
      try {
        const logout = await Promise.race([
          h.request("/api/auth/logout", old),
          new Promise((_, reject) =>
            t.signal.addEventListener(
              "abort",
              () => reject(new Error("Logout waited for persistence")),
              { once: true }
            )
          )
        ]);
        assert.equal(logout.status, 200);
        assert.equal(logout.data, true);
        assert.equal((await h.request("/api/auth/token", old)).status, 403);
        assert.equal((await h.request("/api/auth/token", other)).status, 200);
        assert.equal(
          (
            await h.request("/api/auth/confirm2fa", {
              ...old,
              method: "POST",
              body: request.body
            })
          ).status,
          403
        );
      } finally {
        gate.release();
      }
      const result = await writing;
      assert.equal(result.status, write === "confirm-definite-failure" ? 503 : 200, result.text);
      failure = undefined;
      writeGate = undefined;
      assert.equal((await h.request("/api/auth/token", old)).status, 403);
      assert.equal((await h.request("/api/auth/token", { cookie: result.cookie })).status, 403);
      if (write === "theme") assert.equal(disk.get("player").theme, "nether");
      assert.equal(disk.get("player").open2FA, write === "confirm");
      const fresh = await h.login(
        "player",
        write === "password" ? nextPassword : password,
        write === "confirm" ? code(secret) : undefined
      );
      assert.equal(
        (
          await h.request("/api/auth/confirm2fa", {
            ...fresh,
            method: "POST",
            body: { enable: true, setupId: start.data.setupId, TOTPCode: code(secret) }
          })
        ).status,
        409
      );
      if (write === "theme" || write === "confirm-definite-failure")
        assert.equal((await h.request("/api/auth/token", other)).status, 200);
    }
  );
