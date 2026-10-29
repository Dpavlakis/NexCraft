// Node 24+, no npm dependencies. Run against a completed Vite production build:
// node scripts/frontend-production-smoke.mjs --dist frontend/dist --browser /path/to/chrome
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const { values } = parseArgs({
  options: {
    dist: { type: "string", default: "frontend/dist" },
    browser: { type: "string" },
    port: { type: "string", default: "0" }
  }
});
assert(Number(process.versions.node.split(".")[0]) >= 24, "Node 24+ is required");
assert(values.browser, "Pass --browser with an installed Chrome/Chromium/Edge executable");
const port = Number(values.port);
assert(Number.isInteger(port) && port >= 0 && port <= 65535, "Invalid --port");
const dist = await realpath(values.dist);
const index = await readFile(path.join(dist, "index.html"));
const temp = await realpath(tmpdir());
const output = await mkdtemp(path.join(temp, "nexcraft-production-smoke-"));
const profile = path.join(output, "browser-profile");
const started = Date.now();
const report = {
  dist,
  node: process.version,
  indexSHA256: createHash("sha256").update(index).digest("hex"),
  cases: [],
  requests: [],
  blocked: []
};
console.log(`Production smoke evidence: ${output}`);

// These are read-only protocol fixtures, never a proxy to a real panel/daemon.
const fixtures = {
  "/api/auth/status": {
    isInstall: true,
    language: "en_us",
    versionChange: false,
    settings: {
      panelId: "local-smoke",
      canFileManager: false,
      allowUsePreset: false,
      businessMode: false,
      businessId: "",
      allowChangeCmd: false,
      ssoEnabled: false,
      ssoOnlyMode: false
    }
  },
  "/api/auth/login_info": { loginInfo: "LOCAL SAMPLE FIXTURES" },
  "/api/auth/sso/config": { enabled: false, onlyMode: false, autoRedirect: false },
  "/api/overview/layout": JSON.stringify([
    {
      page: "__settings__",
      items: [],
      theme: { pageTitle: "NexCraft — LOCAL SAMPLE FIXTURES", sidebarPosition: "right" }
    },
    {
      page: "/login",
      items: [{ id: "smoke-login", type: "LoginCard", width: 24, height: "unset" }]
    }
  ])
};
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};
let origin;
const server = createServer(async (req, res) => {
  const respond = (status, body, type = "application/json") => {
    report.requests.push({ method: req.method, url: req.url, status });
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      // Explicit HTTP origin excludes ws:/wss: even for the fixture host.
      "Content-Security-Policy": `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ${origin}; frame-src 'none'; object-src 'none'; form-action 'none'`
    });
    res.end(req.method === "HEAD" ? undefined : body);
  };
  try {
    const url = new URL(req.url, origin);
    if (req.headers.host !== new URL(origin).host) return respond(403, "Forbidden host");
    if (!["GET", "HEAD"].includes(req.method)) return respond(405, "Mutations blocked");
    if (url.pathname === "/api/auth/") {
      return respond(403, JSON.stringify({ status: 403, data: "Unauthenticated sample" }));
    }
    if (Object.hasOwn(fixtures, url.pathname)) {
      return respond(200, JSON.stringify({ status: 200, data: fixtures[url.pathname] }));
    }
    if (/^\/(api|socket\.io|upload|download)(\/|$)/.test(url.pathname)) {
      return respond(403, "No read-only fixture");
    }
    const target = await realpath(
      path.resolve(
        dist,
        "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)
      )
    );
    const relative = path.relative(dist, target);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      return respond(403, "Forbidden path");
    const type = types[path.extname(target)];
    if (!type) return respond(403, "Unsupported static asset");
    respond(200, await readFile(target), type);
  } catch {
    respond(404, "Missing production asset");
  }
});
server.on("upgrade", (req, socket) => {
  report.blocked.push({ socket: req.url });
  socket.destroy();
});

let browser, ws, browserExit, browserError;
let sequence = 0;
let current;
const pending = new Map();
const abort = new AbortController();
function send(method, params = {}, sessionId) {
  if (abort.signal.aborted && method !== "Browser.close")
    return Promise.reject(abort.signal.reason);
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 4000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression, sessionId) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function run() {
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  abort.signal.throwIfAborted();
  origin = `http://localhost:${server.address().port}`;
  report.origin = origin;
  browser = spawn(
    values.browser,
    [
      "--headless=new",
      // Edge otherwise relaunches on Windows and detaches from the owned child.
      ...(process.platform === "win32" &&
      path.basename(values.browser).toLowerCase() === "msedge.exe"
        ? ["--edge-skip-compat-layer-relaunch"]
        : []),
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-extensions",
      "--disable-breakpad",
      "--disable-dev-shm-usage",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
      "about:blank"
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }
  );
  report.browserLog = "";
  browser.stderr.on("data", (data) => {
    report.browserLog = (report.browserLog + data).slice(-12000);
  });
  browser.on("error", (error) => (browserError = error));
  browserExit = new Promise((resolve) => browser.once("exit", resolve));
  let devtools;
  for (let i = 0; i < 100; i++) {
    if (browserError) throw browserError;
    if (browser.exitCode !== null) throw new Error(`Browser exited: ${report.browserLog}`);
    try {
      devtools = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8"))
        .trim()
        .split("\n");
      break;
    } catch {
      await delay(100, undefined, { signal: abort.signal });
    }
  }
  assert(devtools, "Browser did not expose its private CDP port");
  ws = new WebSocket(`ws://127.0.0.1:${devtools[0]}${devtools[1]}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const call = pending.get(message.id);
      if (!call) return;
      clearTimeout(call.timer);
      pending.delete(message.id);
      if (message.error) call.reject(new Error(JSON.stringify(message.error)));
      else call.resolve(message.result);
      return;
    }
    const { method, params, sessionId } = message;
    if (method === "Fetch.requestPaused") {
      const request = params.request;
      const url = new URL(request.url);
      const allowed =
        url.origin === origin &&
        ["GET", "HEAD"].includes(request.method) &&
        !/^\/(socket\.io|upload|download)(\/|$)/.test(url.pathname);
      if (!allowed) report.blocked.push(request);
      send(
        allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
        { requestId: params.requestId, ...(!allowed ? { errorReason: "BlockedByClient" } : {}) },
        sessionId
      ).catch((error) => current?.errors.push(String(error)));
    }
    if (!current || sessionId !== current.sessionId) return;
    if (method === "Runtime.exceptionThrown") current.errors.push(params.exceptionDetails);
    if (method === "Network.loadingFailed") current.failedRequests.push(params);
    if (method === "Network.webSocketCreated") current.errors.push({ socket: params.url });
    if (method === "Network.responseReceived") {
      const { url, status, mimeType } = params.response;
      current.responses.push({ url, status, mimeType });
    }
  });
  report.browser = await send("Browser.getVersion");
  await send("Browser.setDownloadBehavior", { behavior: "deny" });
  for (const [width, height, mode] of [
    [1440, 1000, "light"],
    [390, 844, "dark"]
  ]) {
    // A new context has no cookies, storage, module map or disk cache from the previous load.
    const { browserContextId } = await send("Target.createBrowserContext", {
      disposeOnDetach: true
    });
    const { targetId } = await send("Target.createTarget", {
      url: "about:blank",
      browserContextId
    });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    current = {
      name: `login-${width}-${mode}`,
      sessionId,
      errors: [],
      failedRequests: [],
      responses: []
    };
    report.cases.push(current);
    for (const method of ["Page.enable", "Runtime.enable", "Network.enable"])
      await send(method, {}, sessionId);
    await send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
    await send("Network.setBypassServiceWorker", { bypass: true }, sessionId);
    await send("Network.setBlockedURLs", { urls: ["ws://*", "wss://*"] }, sessionId);
    await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 1, mobile: false },
      sessionId
    );
    await send(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-color-scheme", value: mode }] },
      sessionId
    );
    await send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: `localStorage.setItem('nx-mode', ${JSON.stringify(mode)})` },
      sessionId
    );
    await send("Page.navigate", { url: origin + "/" }, sessionId);
    for (let i = 0; i < 100; i++) {
      current.dom = await evaluate(
        `(() => {
        const root = document.querySelector('#app-mount-point');
        const password = document.querySelector('.login-panel input[type=password]');
        return {
          url: location.href, bodyClass: document.body?.className,
          text: document.body?.innerText.slice(0, 2000),
          vueMounted: !!root?.__vue_app__ && root.childElementCount > 0,
          loaderHidden: document.querySelector('#before-app-mounted') && getComputedStyle(document.querySelector('#before-app-mounted')).display === 'none',
          loginVisible: !!password?.getClientRects().length && !!password.closest('form'),
          width: innerWidth, height: innerHeight
        };
      })()`,
        sessionId
      );
      if (
        current.errors.length ||
        (current.dom.vueMounted && current.dom.loginVisible && current.dom.loaderHidden)
      )
        break;
      await delay(100, undefined, { signal: abort.signal });
    }
    // Observe deferred errors/assets after the form appears, not just the first paint.
    await delay(500, undefined, { signal: abort.signal });
    const screenshot = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    await writeFile(
      path.join(output, `${current.name}.png`),
      Buffer.from(screenshot.data, "base64")
    );
    current.assets = current.responses.filter(({ url }) =>
      new URL(url).pathname.startsWith("/assets/")
    );
    current.badResponses = current.responses.filter(
      ({ url, status }) =>
        status !== 200 && !(new URL(url).pathname === "/api/auth/" && status === 403)
    );
    current.pass =
      current.errors.length === 0 &&
      current.failedRequests.length === 0 &&
      current.badResponses.length === 0 &&
      current.assets.some(({ mimeType }) => mimeType.includes("javascript")) &&
      current.dom.vueMounted &&
      current.dom.loginVisible &&
      current.dom.loaderHidden &&
      current.dom.bodyClass.includes(`app-${mode}-theme`);
    console.log(
      `${current.pass ? "PASS" : "FAIL"} ${current.name}: Vue=${current.dom.vueMounted}, login=${
        current.dom.loginVisible
      }, pageErrors=${current.errors.length}, assets=${current.assets.length}`
    );
    if (!current.pass) {
      console.error(
        JSON.stringify(
          {
            name: current.name,
            dom: current.dom,
            errors: current.errors.map((error) => error.exception?.description ?? error),
            failedRequests: current.failedRequests,
            badResponses: current.badResponses
          },
          null,
          2
        )
      );
    }
    await send("Target.disposeBrowserContext", { browserContextId });
    current = undefined;
  }
  assert(
    report.cases.every((entry) => entry.pass),
    "Production browser boot failed; see report.json"
  );
  assert.equal(report.blocked.length, 0, "Unexpected external/mutation/socket request");
}

let deadline;
let interrupt;
const interrupted = new Promise((_, reject) => {
  interrupt = reject;
});
const stop = () => interrupt(new Error("Smoke interrupted"));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  await Promise.race([
    run(),
    interrupted,
    new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error("Smoke exceeded 50 seconds")), 50000);
    })
  ]);
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.error = String(error);
  process.exitCode = 1;
  console.error(error);
} finally {
  clearTimeout(deadline);
  abort.abort(new Error("Smoke closed"));
  if (ws?.readyState === WebSocket.OPEN) {
    await send("Browser.close").catch(() => {});
    ws.close();
  }
  if (browser && browser.exitCode === null && !browserError) {
    await Promise.race([browserExit, delay(1000)]);
    if (browser.exitCode === null) browser.kill();
    await Promise.race([browserExit, delay(1000)]);
    if (browser.exitCode === null && browser.signalCode === null) {
      browser.kill("SIGKILL");
      await Promise.race([browserExit, delay(500)]);
    }
  }
  for (const call of pending.values()) {
    clearTimeout(call.timer);
    call.reject(new Error("Smoke closed"));
  }
  server.closeAllConnections();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  // Only delete this invocation's verified mkdtemp profile, after its child exits.
  if (
    (!browser || browser.exitCode !== null || browser.signalCode !== null || browserError) &&
    path.dirname(output) === temp &&
    path.basename(output).startsWith("nexcraft-production-smoke-") &&
    path.dirname(profile) === output
  ) {
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(
      (error) => {
        report.cleanupError = String(error);
        report.pass = false;
        process.exitCode = 1;
      }
    );
  }
  report.elapsedMs = Date.now() - started;
  report.cleanup = {
    browserExited:
      !browser || browser.exitCode !== null || browser.signalCode !== null || !!browserError,
    serverClosed: !server.listening
  };
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
