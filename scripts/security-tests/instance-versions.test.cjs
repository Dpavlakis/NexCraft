"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");
const ts = require("../../panel/node_modules/typescript");
require("../../panel/node_modules/ts-node").register({
  project: path.resolve(__dirname, "../../panel/tsconfig.json"),
  transpileOnly: true
});
const selection = require("../../frontend/src/tools/instanceVersions.ts");
const { selectInstanceUpdate, installedInstanceVersions } = selection;
// Exercise the real hook with a minimal controlled reactivity boundary; no Vue package is loaded.
let hookScope;
let apiLoad;
const vueBoundary = {
  computed: (getter) => ({
    get value() {
      return getter();
    }
  }),
  shallowRef: (value) => ({ value }),
  watch: (source, callback, options) => {
    const read = () => Array.isArray(source)
      ? source.map((item) => typeof item === "function" ? item() : item.value)
      : typeof source === "function" ? source() : source.value;
    const watcher = { read, callback, previous: read() };
    hookScope.watchers.push(watcher);
    if (options?.immediate) callback();
  },
  onBeforeUnmount: (callback) => hookScope.teardowns.push(callback)
};
function scope() {
  const current = { watchers: [], teardowns: [] };
  hookScope = current;
  return {
    flush() {
      for (const watcher of current.watchers) {
        const next = watcher.read();
        const changed = Array.isArray(next)
          ? next.some((item, index) => item !== watcher.previous[index])
          : watcher.previous !== next;
        if (changed) {
          watcher.previous = next;
          watcher.callback();
        }
      }
    },
    dispose() {
      current.teardowns.forEach((callback) => callback());
    }
  };
}
const apiBoundary = Object.fromEntries(["modpackVersions", "serverVersionsGet"].map((name) => [
  name, () => ({ execute: async (config) => ({ value: await apiLoad(config.params, config, name) }) })
]));
// Frontend packages are deliberately not required by the security-test CI job.
const originalLoad = Module._load;
Module._load = function (id, parent, ...args) {
  if (parent?.filename.endsWith(path.join("hooks", "useInstanceVersions.ts"))) {
    if (id === "vue") return vueBoundary;
    if (id === "@/services/apis/modpack") return apiBoundary;
    if (id === "@/tools/instanceVersions") return selection;
  }
  return originalLoad.call(this, id, parent, ...args);
};
let createInstanceVersionCache, publishInstanceVersions, useInstanceVersions, INSTANCE_VERSIONS_TTL, INSTANCE_VERSIONS_TIMEOUT;
try {
  ({
    createInstanceVersionCache,
    publishInstanceVersions,
    useInstanceVersions,
    INSTANCE_VERSIONS_TTL,
    INSTANCE_VERSIONS_TIMEOUT
  } = require("../../frontend/src/hooks/useInstanceVersions.ts"));
} finally {
  Module._load = originalLoad;
}

const pack = {
  source: "modrinth",
  projectId: "project",
  fileId: "opaque-installed",
  versionName: "Pack 2",
  mcVersion: "1.21.1",
  loader: "fabric"
};
const release = (id, extra = {}) => ({
  id,
  game_versions: ["1.21.1"],
  loaders: ["fabric"],
  version_type: "release",
  ...extra
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("installed provenance stays distinct from live ping and missing metadata stays unknown", () => {
  assert.deepEqual(installedInstanceVersions(pack, { mcPingOnline: true, version: "runtime" }), {
    isModpack: true,
    isBedrock: false,
    packVersion: "Pack 2",
    minecraftVersion: "1.21.1",
    bdsVersion: undefined,
    liveVersion: undefined
  });
  const noMetadata = installedInstanceVersions(undefined, {
    mcPingOnline: false,
    version: "stale"
  });
  assert.equal(noMetadata.minecraftVersion, undefined);
  assert.equal(noMetadata.liveVersion, undefined);
  assert.equal(
    installedInstanceVersions(undefined, { mcPingOnline: true, version: "live" }).liveVersion,
    "live"
  );
  const bds = installedInstanceVersions({ source: "bedrock", mcVersion: "1.21.100" });
  assert.equal(bds.isBedrock, true);
  assert.equal(bds.bdsVersion, "1.21.100");
  assert.equal(bds.packVersion, undefined);
});

test("known opaque installed IDs are compared per consumer using provider release order", () => {
  const rows = [release("0001"), release(pack.fileId)];
  assert.equal(selectInstanceUpdate(pack, rows).status, "available");
  assert.equal(selectInstanceUpdate({ ...pack, fileId: "0001" }, rows).status, "current");
  assert.equal(selectInstanceUpdate({ ...pack, fileId: "999999999999" }, rows).status, "unknown");
  assert.equal(selectInstanceUpdate({ ...pack, fileId: "" }, rows).status, "unknown");
  assert.equal(selectInstanceUpdate(pack, []).status, "unknown");
});

test("publish dates sort stably without mutating provider data or numerically comparing IDs", () => {
  const rows = [
    release(pack.fileId, { date_published: "2026-01-01" }),
    release("z-old", { date_published: "2025-01-01" }),
    release("a-new", { date_published: "2026-02-01" })
  ];
  const result = selectInstanceUpdate(pack, rows);
  assert.equal(result.latest.id, "a-new");
  assert.equal(rows[0].id, pack.fileId);
  assert.equal(
    selectInstanceUpdate(pack, [release("tie", { date_published: "2026-01-01" }), rows[0]]).status,
    "unknown"
  );
  // Missing dates preserve the provider contract instead of partially sorting incomparable entries.
  assert.equal(selectInstanceUpdate(pack, [release(pack.fileId), rows[2]]).status, "current");
});

test("game version, loader, and release channel compatibility filter update candidates", () => {
  const current = release(pack.fileId);
  for (const incompatible of [
    release("new", { game_versions: ["1.22"] }),
    release("new", { loaders: ["forge"] }),
    release("new", { version_type: "beta" })
  ])
    assert.equal(selectInstanceUpdate(pack, [incompatible, current]).status, "current");
  assert.equal(
    selectInstanceUpdate(pack, [release("missing", { loaders: [] }), current]).status,
    "unknown"
  );
  assert.equal(
    selectInstanceUpdate(pack, [release("missing", { version_type: "" }), current]).status,
    "unknown"
  );
  assert.equal(
    selectInstanceUpdate(pack, [release("cross"), release(pack.fileId, { version_type: "" })])
      .status,
    "unknown"
  );
  const compatible = release("compatible", {
    game_versions: ["1.20", "1.21.1"],
    loaders: ["fabric", "quilt"]
  });
  assert.equal(selectInstanceUpdate(pack, [compatible, current]).status, "available");
});

test("CurseForge requires a server pack and sorts by its actual fileDate field", () => {
  const cf = { ...pack, source: "curseforge", fileId: "installed" };
  const cfRelease = (fileId, extra = {}) => ({
    fileId,
    mcVersion: pack.mcVersion,
    loader: pack.loader,
    releaseType: 1,
    hasServerPack: true,
    ...extra
  });
  const installed = cfRelease(cf.fileId, { fileDate: "2026-01-01" });
  const latest = cfRelease("latest", { fileDate: "2026-02-01" });
  assert.equal(selectInstanceUpdate(cf, [installed, latest]).status, "available");
  assert.equal(
    selectInstanceUpdate(cf, [{ ...latest, hasServerPack: false }, installed]).status,
    "current"
  );
  assert.equal(
    selectInstanceUpdate(cf, [{ ...latest, hasServerPack: undefined }, installed]).status,
    "unknown"
  );
});

test("unsupported providers and absent Bedrock installed releases never imply up to date", () => {
  for (const source of ["ftb", "vanilla", "serverjar"]) {
    assert.equal(selectInstanceUpdate({ ...pack, source }, []).status, "unsupported");
  }
  assert.equal(selectInstanceUpdate(undefined, []).status, "unknown");
  const stable = { id: "1.21.100", type: "release" };
  const preview = { id: "1.22.0", type: "preview" };
  const bds = { source: "bedrock", mcVersion: stable.id };
  assert.equal(selectInstanceUpdate(bds, [stable, preview]).status, "current");
  assert.equal(
    selectInstanceUpdate({ ...bds, mcVersion: "1.21.90" }, [stable, preview]).status,
    "unknown"
  );
  assert.equal(
    selectInstanceUpdate({ ...bds, mcVersion: preview.id }, [stable, preview]).status,
    "current"
  );
});

test("cache deduplicates in-flight projects and reuses data until TTL expires", async () => {
  let now = 0;
  let calls = 0;
  const pending = deferred();
  const cache = createInstanceVersionCache(
    async () => {
      calls++;
      return pending.promise;
    },
    { now: () => now, ttl: 100 }
  );
  const target = { source: "modrinth", projectId: "same" };
  const a = cache.get(target);
  const b = cache.get({ ...target });
  assert.equal(a, b);
  await tick();
  assert.equal(calls, 1);
  pending.resolve([release("latest"), release(pack.fileId)]);
  const snapshot = await a;
  assert.equal(snapshot.status, "ready");
  assert.equal(selectInstanceUpdate(pack, snapshot.releases).status, "available");
  assert.equal(
    selectInstanceUpdate({ ...pack, fileId: "latest" }, snapshot.releases).status,
    "current"
  );
  now = 99;
  assert.equal(await cache.get(target), snapshot);
  now = 100;
  assert.notEqual(await cache.get(target), snapshot);
  assert.equal(calls, 2);
});

test("cache isolates provider/project identities, evicts LRU data, and bounds concurrency and queue", async () => {
  const pending = [];
  let active = 0;
  let peak = 0;
  const calls = [];
  const cache = createInstanceVersionCache(
    async (target) => {
      calls.push(target);
      active++;
      peak = Math.max(peak, active);
      const job = deferred();
      pending.push(job);
      await job.promise;
      active--;
      return [];
    },
    { concurrency: 2, maxSize: 3 }
  );
  const first = cache.get({ source: "modrinth", projectId: "a" });
  const second = cache.get({ source: "curseforge", projectId: "a" });
  const third = cache.get({ source: "modrinth", projectId: "b" });
  const saturated = await cache.get({ source: "modrinth", projectId: "c" });
  assert.equal(saturated.status, "error");
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(peak, 2);
  pending[0].resolve();
  await first;
  await tick();
  assert.equal(calls.length, 3);
  assert.equal(peak, 2);
  pending[1].resolve();
  pending[2].resolve();
  await Promise.all([second, third]);
  // Touch first to keep it recent; next request must evict second.
  await cache.get({ source: "modrinth", projectId: "a" });
  const fourth = cache.get({ source: "modrinth", projectId: "d" });
  await tick();
  pending[3].resolve();
  await fourth;
  assert.equal(calls.length, 4);
  const evicted = cache.get({ source: "curseforge", projectId: "a" });
  await tick();
  assert.equal(calls.length, 5);
  pending[4].resolve();
  await evicted;
});

test("failed and invalid responses stay error and retry after short error TTL", async () => {
  let now = 0;
  let calls = 0;
  const cache = createInstanceVersionCache(
    async () => {
      calls++;
      if (calls === 1) throw new Error("provider unavailable");
      if (calls === 2) return null;
      return [];
    },
    { now: () => now }
  );
  const target = { source: "bedrock", projectId: "bds" };
  assert.equal((await cache.get(target)).status, "error");
  now = 59999;
  assert.equal((await cache.get(target)).status, "error");
  assert.equal(calls, 1);
  now = 60000;
  assert.equal((await cache.get(target)).status, "error");
  now = 120000;
  assert.equal((await cache.get(target)).status, "ready");
  assert.equal(calls, 3);
});

test("actual hook ignores poll object replacement and recomputes installed changes from shared cache", async () => {
  const context = scope();
  let calls = 0;
  const pending = deferred();
  apiLoad = async () => {
    calls++;
    return pending.promise;
  };
  let value = {
    instanceUuid: "hook-poll",
    config: { packInfo: { ...pack, projectId: "hook-poll" } },
    info: {}
  };
  const hook = useInstanceVersions(() => value);
  try {
    assert.equal(hook.update.value.status, "loading");
    value = {
      ...value,
      config: { packInfo: { ...value.config.packInfo } },
      info: { version: "runtime" }
    };
    context.flush();
    await tick();
    assert.equal(calls, 1);
    pending.resolve([release("latest"), release(pack.fileId)]);
    await tick();
    assert.equal(hook.update.value.status, "available");
    value = {
      ...value,
      config: { packInfo: { ...value.config.packInfo, fileId: "latest", versionName: "Newest" } }
    };
    context.flush();
    await tick();
    assert.equal(hook.update.value.status, "current");
    assert.equal(hook.installed.value.packVersion, "Newest");
    assert.equal(calls, 1);
  } finally {
    context.dispose();
  }
});

test("actual hook rejects stale provider results after target changes and unmount", async () => {
  const context = scope();
  const pending = new Map();
  apiLoad = async ({ projectId }) => {
    const job = deferred();
    pending.set(projectId, job);
    return job.promise;
  };
  let value = {
    instanceUuid: "hook-stale",
    config: { packInfo: { ...pack, projectId: "stale-a" } },
    info: {}
  };
  const hook = useInstanceVersions(() => value);
  try {
    await tick();
    value = { ...value, config: { packInfo: { ...pack, projectId: "stale-b" } } };
    context.flush();
    await tick();
    pending.get("stale-b").resolve([release(pack.fileId)]);
    await tick();
    assert.equal(hook.update.value.status, "current");
    pending.get("stale-a").resolve([release("new"), release(pack.fileId)]);
    await tick();
    assert.equal(hook.update.value.status, "current");
    value = { ...value, config: { packInfo: { ...pack, projectId: "stale-c" } } };
    context.flush();
    await tick();
    context.dispose();
    pending.get("stale-c").resolve([release("new"), release(pack.fileId)]);
    await tick();
    assert.equal(hook.update.value.status, "loading");
  } finally {
    context.dispose();
  }
});

test("actual hook distinguishes errors, unsupported providers, and missing provenance without unnecessary requests", async () => {
  const context = scope();
  let calls = 0;
  apiLoad = async () => {
    calls++;
    throw new Error("offline");
  };
  let value = { instanceUuid: "hook-states", config: { packInfo: undefined }, info: {} };
  const hook = useInstanceVersions(() => value);
  try {
    assert.equal(hook.update.value.status, "unknown");
    value = { ...value, config: { packInfo: { ...pack, source: "ftb" } } };
    context.flush();
    assert.equal(hook.update.value.status, "unsupported");
    value = { ...value, config: { packInfo: { ...pack, fileId: "" } } };
    context.flush();
    assert.equal(hook.update.value.status, "unknown");
    assert.equal(calls, 0);
    value = { ...value, config: { packInfo: { ...pack, projectId: "hook-error" } } };
    context.flush();
    assert.equal(hook.update.value.status, "loading");
    await tick();
    assert.equal(hook.update.value.status, "error");
    assert.equal(calls, 1);
  } finally {
    context.dispose();
  }
});


test("default successful cache entries live for ten minutes", async () => {
  assert.equal(INSTANCE_VERSIONS_TTL, 600000);
  let now = 0;
  let calls = 0;
  const cache = createInstanceVersionCache(async () => { calls++; return []; }, { now: () => now });
  const target = { source: "modrinth", projectId: "ten-minutes" };
  const snapshot = await cache.get(target);
  assert.equal(snapshot.expiresAt, 600000);
  now = 599999;
  assert.equal(await cache.get(target), snapshot);
  now = 600000;
  assert.notEqual(await cache.get(target), snapshot);
  assert.equal(calls, 2);
});

test("four stalled loaders time out, abort, release the pool, and retry only after error TTL", { timeout: 2000 }, async () => {
  let now = 0;
  let recover = false;
  const calls = [];
  const signals = [];
  const stalled = [];
  const cache = createInstanceVersionCache(async (target, signal) => {
    calls.push(target.projectId);
    signals.push(signal);
    if (target.projectId === "queued" || recover) return [];
    const pending = deferred();
    stalled.push(pending);
    return pending.promise; // Deliberately ignores cancellation.
  }, { now: () => now, timeout: 20 });
  const targets = ["a", "b", "c", "d"].map((projectId) => ({ source: "modrinth", projectId }));
  const pending = targets.map((target) => cache.get(target));
  assert.equal(cache.get(targets[0]), pending[0]);
  const queued = cache.get({ source: "modrinth", projectId: "queued" });
  await tick();
  assert.equal(calls.length, 4);
  const snapshots = await Promise.all(pending);
  assert.ok(snapshots.every((value) => value.status === "error" && value.expiresAt === 60000));
  assert.equal((await queued).status, "ready");
  assert.ok(signals.slice(0, 4).every((signal) => signal.aborted));
  // Late completion must not overwrite the timeout snapshot or free another seat.
  stalled[0].resolve([release("late")]);
  await tick();
  now = 59999;
  assert.equal(await cache.get(targets[0]), snapshots[0]);
  assert.equal(calls.length, 5);
  recover = true;
  now = 60000;
  assert.equal((await cache.get(targets[0])).status, "ready");
  assert.equal(calls.length, 6);
});

test("settled successful and failed loads clear their abort timers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals = [];
  const cache = createInstanceVersionCache(async (target, signal) => {
    signals.push(signal);
    if (target.projectId === "failure") throw new Error("offline");
    return [];
  }, { timeout: 10 });
  assert.equal((await cache.get({ source: "modrinth", projectId: "success" })).status, "ready");
  assert.equal((await cache.get({ source: "modrinth", projectId: "failure" })).status, "error");
  t.mock.timers.tick(100);
  assert.ok(signals.every((signal) => !signal.aborted));
});

test("forced modpack and Bedrock requests carry a timeout and cache-owned AbortSignal", async () => {
  const pending = deferred();
  const requests = [];
  apiLoad = async (_, config, name) => {
    requests.push({ config, name });
    return name === "modpackVersions" ? pending.promise : [{ id: "bds-current", type: "release" }];
  };
  const instance = { instanceUuid: "shared-timeout", config: { packInfo: { ...pack, projectId: "shared-timeout" } }, info: {} };
  const first = scope();
  const firstHook = useInstanceVersions(() => instance);
  const second = scope();
  const secondHook = useInstanceVersions(() => instance);
  const bedrock = scope();
  const bedrockHook = useInstanceVersions(() => ({
    ...instance, config: { packInfo: { source: "bedrock", mcVersion: "bds-current" } }
  }));
  try {
    await tick();
    assert.equal(requests.length, 2);
    for (const { config } of requests) {
      assert.equal(config.forceRequest, true);
      assert.equal(config.timeout, INSTANCE_VERSIONS_TIMEOUT);
      assert.equal(config.timeout, 30000);
      assert.ok(config.signal instanceof AbortSignal);
    }
    first.dispose();
    assert.equal(requests[0].config.signal.aborted, false);
    pending.resolve([release("new"), release(pack.fileId)]);
    await tick();
    assert.equal(firstHook.update.value.status, "loading");
    assert.equal(secondHook.update.value.status, "available");
    assert.equal(bedrockHook.update.value.status, "current");
    assert.ok(requests.every(({ config }) => !config.signal.aborted));
  } finally {
    first.dispose();
    second.dispose();
    bedrock.dispose();
  }
});

// Compile the actual <script setup> with panel's TypeScript, not frontend dependencies.
function loadFrontendScript(relative, exposed, mocks, props = {}) {
  const filename = path.resolve(__dirname, "../..", relative);
  const source = fs.readFileSync(filename, "utf8");
  const script = relative.endsWith(".vue")
    ? source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1] : source;
  const compiled = ts.transpileModule(script, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
  }).outputText;
  return new Function("require", "defineProps", "exports", `${compiled}\nreturn { ${exposed.join(", ")} };`)(
    (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      throw new Error(`Unexpected frontend dependency: ${id}`);
    }, () => props, {}
  );
}

// Progress is a UI boundary here; the dedicated progress tests exercise the real poll lifecycle.
// Still invoke create so native version guards must prevent unsafe update API calls.
const operationProgressBoundary = {
  useOperationProgress: () => {
    const busy = { value: false };
    const task = { value: null };
    const failure = { value: undefined };
    return {
      busy, task, failure,
      start: async (create) => { await create(); },
      attach: async (existing) => { busy.value = true; task.value = existing; },
      reset: () => { busy.value = false; task.value = null; failure.value = undefined; }
    };
  }
};

const routeContext = { daemonId: "daemon-a", instanceId: "instance-a" };
function updateQuery(versionId = "compatible-old", extra = {}) {
  return {
    ...routeContext, updateDaemonId: routeContext.daemonId, updateInstanceId: routeContext.instanceId,
    updateSource: pack.source, updateProjectId: pack.projectId, updateVersionId: versionId, ...extra
  };
}
function panelHarness(rows, query = updateQuery(), installedPack = pack, meta = routeContext, loadRows = async () => rows) {
  const context = scope();
  const requests = [];
  const notes = [];
  const updates = [];
  const route = { path: "/instances/modpackUpdate", query };
  const api = (name) => () => ({ execute: async (config) => {
    requests.push({ name, config });
    if (name === "modpackChangelog") {
      notes.push(config.params);
      return { value: { content: "Publisher notes", format: "html" } };
    }
    if (name === "getInstanceInfo") return { value: { config: { packInfo: installedPack } } };
    if (name === "updateModpack" || name === "reinstallServer") {
      updates.push(config);
      return { value: {} }; // No task polling in this harness.
    }
    return { value: await loadRows(config, name) };
  } });
  const panel = loadFrontendScript("frontend/src/widgets/instance/ModpackUpdate.vue", [
    "packInfo", "versions", "selectedVersion", "requestedVersion", "loadInfo", "loadVersions", "loadChangelog", "runUpdate", "discoverActiveTask"
  ], {
    vue: { ...vueBoundary, ref: (value) => ({ value }), inject: (_, fallback) => fallback, onMounted() {} },
    "vue-router": { useRoute: () => route },
    "@/hooks/useAppRouters": { useAppRouters: () => ({ toPage() {} }) },
    "@/hooks/useInstanceVersions": { INSTANCE_VERSIONS_TIMEOUT, publishInstanceVersions },
    "@/hooks/useOperationProgress": operationProgressBoundary,
    "@/hooks/useCardTools": { useLayoutCardTools: () => ({ getMetaOrRouteValue: (key) => meta[key] }) },
    "@/hooks/useScreen": { useScreen: () => ({ isPhone: { value: false } }) },
    "@/lang/i18n": { t: (key) => key },
    "@/services/apis/instance": { getInstanceInfo: api("getInstanceInfo") },
    "@/services/apis/modpack": {
      ...Object.fromEntries([
        "modpackVersions", "serverVersionsGet", "modpackChangelog", "modpackTaskStatus", "reinstallServer", "updateModpack"
      ].map((name) => [name, api(name)])),
      activeModpackTask: () => ({ execute: async () => ({ value: { task: null } }) })
    },
    "@/tools/instanceVersions": selection,
    "@/tools/validator": { reportErrorMsg() {} },
    "@ant-design/icons-vue": {},
    "ant-design-vue": { message: { success() {} } },
    marked: { marked: { parse: (value) => value } },
    "sanitize-html": (value) => value,
    "@/components/BetweenMenus.vue": {},
    "@/components/CardPanel.vue": {},
    "@/components/OperationProgress.vue": {}
  }, { card: { meta } });
  panel.packInfo.value = installedPack;
  // Settle the real idle-discovery guard; each case still controls its version requests.
  // Otherwise unsafe-ID checks could pass solely because checkingActive never cleared.
  void panel.discoverActiveTask();
  return { ...panel, context, route, requests, notes, updates };
}

const incompatibleRows = () => [
  release("different-mc", { game_versions: ["1.22"] }),
  release("different-loader", { loaders: ["forge"] }),
  release("different-channel", { version_type: "beta" }),
  release("compatible-new"), release("compatible-old"), release(pack.fileId)
];

test("badge navigation preserves route query and opens the exact compatible candidate and notes", async () => {
  const rows = incompatibleRows().filter((row) => row.id !== "compatible-new");
  const route = { query: { tab: "keep-me", ...updateQuery("stray", { updateSource: "curseforge" }) } };
  let navigation;
  const routers = loadFrontendScript("frontend/src/hooks/useAppRouters.ts", ["useAppRouters"], {
    "@/config/router": { router: { push: (value) => { navigation = value; } } },
    "vue-router": { useRoute: () => route }
  });
  const admin = { value: true };
  const badge = loadFrontendScript("frontend/src/components/InstanceVersionInfo.vue", ["openUpdate"], {
    vue: vueBoundary,
    "@/lang/i18n": { t: (key) => key },
    "@/hooks/useAppRouters": routers,
    "@/hooks/useInstanceVersions": { useInstanceVersions: () => ({
      installed: { value: installedInstanceVersions(pack) },
      update: { value: selectInstanceUpdate(pack, rows) }
    }) },
    "@/tools/instanceVersions": selection,
    "@/stores/useAppStateStore": { useAppStateStore: () => ({ isAdmin: admin }) }
  }, { instance: { instanceUuid: routeContext.instanceId, config: { packInfo: pack } }, daemonId: routeContext.daemonId });
  badge.openUpdate();
  assert.equal(navigation.path, "/instances/modpackUpdate");
  assert.deepEqual(navigation.query, { tab: "keep-me", ...updateQuery() });
  const panel = panelHarness(rows, navigation.query);
  try {
    await panel.loadInfo();
    assert.equal(panel.selectedVersion.value, "compatible-old");
    await panel.loadChangelog();
    assert.deepEqual(panel.notes.at(-1), { source: pack.source, projectId: pack.projectId, versionId: "compatible-old" });
    admin.value = false;
    navigation = undefined;
    badge.openUpdate();
    assert.equal(navigation, undefined);
  } finally { panel.context.dispose(); }
});

test("panel honors a valid older candidate but ignores merged context and malformed query values", async () => {
  const cases = [
    [{}, "compatible-old"],
    [{ updateInstanceId: "other-instance" }, "compatible-new"],
    [{ updateDaemonId: "other-daemon" }, "compatible-new"],
    [{ instanceId: "other-instance" }, "compatible-new"],
    [{ daemonId: "other-daemon" }, "compatible-new"],
    [{ updateSource: "curseforge" }, "compatible-new"],
    [{ updateProjectId: "other-project" }, "compatible-new"],
    [{ updateVersionId: ["compatible-old"] }, "compatible-new"],
    [{ updateVersionId: "missing" }, "compatible-new"],
    [{ updateVersionId: "different-mc" }, "compatible-new"],
    [{ updateVersionId: "different-loader" }, "compatible-new"],
    [{ updateVersionId: "different-channel" }, "compatible-new"]
  ];
  for (const [query, expected] of cases) {
    const panel = panelHarness(incompatibleRows(), updateQuery("compatible-old", query));
    try {
      await panel.loadVersions();
      assert.equal(panel.selectedVersion.value, expected, JSON.stringify(query));
    } finally { panel.context.dispose(); }
  }
  const embedded = panelHarness(incompatibleRows(), updateQuery());
  try {
    embedded.route.path = "/instances/terminal";
    await embedded.loadVersions();
    assert.equal(embedded.selectedVersion.value, "compatible-new");
    embedded.route.path = "/instances/modpackUpdate";
    embedded.context.flush();
    assert.equal(embedded.selectedVersion.value, "compatible-old");
    embedded.route.query.updateInstanceId = "other-instance";
    embedded.context.flush();
    assert.equal(embedded.selectedVersion.value, "compatible-new");
  } finally { embedded.context.dispose(); }
});

test("missing candidates fall back to installed or empty; unsafe IDs never reach update APIs", async () => {
  const scenarios = [
    [[release("different-mc", { game_versions: ["1.22"] }), release(pack.fileId)], pack.fileId],
    [[release("different-mc", { game_versions: ["1.22"] })], ""],
    [[], ""]
  ];
  for (const [rows, expected] of scenarios) {
    const panel = panelHarness(rows);
    try {
      await panel.loadVersions();
      assert.equal(panel.selectedVersion.value, expected);
      panel.selectedVersion.value = "arbitrary-query-id";
      await panel.runUpdate();
      assert.equal(panel.updates.length, 0);
    } finally { panel.context.dispose(); }
  }
  const cf = { ...pack, source: "curseforge" };
  const panel = panelHarness([
    { fileId: "client-only", hasServerPack: false, releaseType: 1, mcVersion: cf.mcVersion, loader: cf.loader },
    { fileId: cf.fileId, hasServerPack: true, releaseType: 1 }
  ], updateQuery("client-only", { updateSource: "curseforge" }), cf);
  try {
    await panel.loadVersions();
    assert.equal(panel.selectedVersion.value, cf.fileId);
    panel.selectedVersion.value = "client-only";
    await panel.runUpdate();
    assert.equal(panel.updates.length, 0);
  } finally { panel.context.dispose(); }
});

test("Bedrock panel keeps channel metadata when choosing its compatible release", async () => {
  const installed = { source: "bedrock", mcVersion: "bds-installed" };
  const panel = panelHarness([
    { id: "bds-preview", type: "snapshot" },
    { id: "bds-stable", type: "release" },
    { id: "bds-installed", type: "release" }
  ], updateQuery("bds-preview", { updateSource: "bedrock", updateProjectId: "bds" }), installed);
  try {
    await panel.loadVersions();
    assert.equal(panel.selectedVersion.value, "bds-stable");
    assert.equal(panel.requests[0].name, "serverVersionsGet");
    assert.equal(panel.requests[0].config.timeout, 30000);
  } finally { panel.context.dispose(); }
});


test("panel version loads ignore old project responses and abort only their own requests", async () => {
  const jobs = [];
  const panel = panelHarness([], updateQuery(), pack, routeContext, async () => {
    const job = deferred();
    jobs.push(job);
    return job.promise;
  });
  try {
    const first = panel.loadVersions();
    const firstSignal = panel.requests[0].config.signal;
    panel.packInfo.value = { ...pack, projectId: "new-project" };
    const second = panel.loadVersions();
    assert.equal(firstSignal.aborted, true);
    const secondSignal = panel.requests[1].config.signal;
    assert.equal(secondSignal.aborted, false);
    jobs[1].resolve([release("new-project-latest"), release(pack.fileId)]);
    await second;
    assert.equal(panel.selectedVersion.value, "new-project-latest");
    jobs[0].resolve([release("old-project-latest"), release(pack.fileId)]);
    await first;
    assert.equal(panel.selectedVersion.value, "new-project-latest");
    const third = panel.loadVersions();
    const thirdSignal = panel.requests[2].config.signal;
    panel.context.dispose();
    assert.equal(thirdSignal.aborted, true);
    jobs[2].resolve([release("after-unmount"), release(pack.fileId)]);
    await third;
    assert.equal(panel.selectedVersion.value, "");
  } finally { panel.context.dispose(); }
});

test("contradictory stored loader and exact installed CurseForge release stay unknown", () => {
  const pack = { source: "curseforge", projectId: "1", fileId: "old", loader: "fabric", mcVersion: "1.21.1" };
  const rows = ["new", "old"].map((fileId) => ({ fileId, loader: "neoforge", mcVersion: "1.21.1", hasServerPack: true, releaseType: 2 }));
  assert.deepEqual(selectInstanceUpdate(pack, rows), { status: "unknown" });
  assert.equal(pack.loader, "fabric");
  assert.deepEqual(selectInstanceUpdate(pack, [rows[1]]), { status: "unknown" });
  assert.equal(selectInstanceUpdate({ ...pack, loader: "neoforge" }, rows).status, "available");
});

test("legacy CurseForge vanilla fallback resolves exact installed IDs but preserves incomplete unknowns", () => {
  const pack = { source: "curseforge", projectId: "1", fileId: "old", loader: "vanilla", mcVersion: "1.21.1" };
  const current = { fileId: "old", loader: "neoforge", mcVersion: "1.21.1", hasServerPack: true, releaseType: 2 };
  const newer = { ...current, fileId: "new" };
  assert.deepEqual(selectInstanceUpdate(pack, [current]), { status: "current" });
  assert.deepEqual(selectInstanceUpdate(pack, [newer, current]), { status: "available", latest: newer });
  assert.deepEqual(selectInstanceUpdate(pack, [newer]), { status: "unknown" });
  assert.deepEqual(selectInstanceUpdate(pack, [{ ...current, loader: "vanilla" }]), { status: "unknown" });
  assert.deepEqual(selectInstanceUpdate(pack, [{ ...newer, loader: undefined }, current]), { status: "unknown" });
  assert.deepEqual(selectInstanceUpdate(pack, [{ ...newer, releaseType: undefined }, current]), { status: "unknown" });
  assert.equal(pack.loader, "vanilla");
});

test("contradictory stored Minecraft version and exact installed release stay unknown", () => {
  const rows = [release("new"), release(pack.fileId)];
  const mismatch = { ...pack, mcVersion: "1.20.1" };
  assert.deepEqual(selectInstanceUpdate(mismatch, rows), { status: "unknown" });
  assert.equal(mismatch.mcVersion, "1.20.1");
  assert.equal(selectInstanceUpdate(pack, rows).status, "available");
});
