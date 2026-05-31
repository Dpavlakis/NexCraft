# Import an Existing Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin upload a `.zip` of an existing Minecraft server (Java or Bedrock), have NexCraft auto-detect the loader/version/start-command/world, optionally identify the modpack, and finalize it as a runnable instance — as-is, linked to a pack, or reinstalled fresh while keeping the world.

**Architecture:** Reuse the existing **Import Compressed Package** flow to upload+unpack+create the instance, then add a **detect → review → finalize** layer. Detection extends `ModloaderBootstrap.detectStartFromExisting` (extracted into a shared function). Pack identification is panel-side (CurseForge fingerprints / Modrinth index / name-search) over data the daemon surfaces. The three outcomes are thin: *as-is* sets the start command, *link* writes `packInfo`, *reinstall* calls the existing `modpack/reinstall` with `resetMode: "preserve_world"`.

**Tech Stack:** Daemon (Node/TS, webpack), Panel (Koa/TS, webpack), Frontend (Vue 3 + Ant Design Vue + vue-i18n, vue-tsc/vite), `node-stream-zip`, `mcsmanager-common`.

**Verification model (READ THIS):** This repo has **no unit-test runner**. The gate for every task is:
- Daemon changes: `npm run build --prefix daemon` (webpack = typecheck) — expect `compiled successfully`.
- Panel changes: `npm run build --prefix panel` — expect `compiled successfully`.
- Frontend changes: `npm run type-check --prefix frontend` — expect no errors; optionally `npm run build --prefix frontend`.
- Behavior is verified **manually in the running app** per the matrix in Task 13.
- Panel `tsconfig` targets **ES2018** — no `String.prototype.matchAll`; use a `g`-flagged `RegExp.exec` loop.
- `a-select` v-model rejects `null` — use `undefined`.
- PowerShell prefix for every command:
  `$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft;`
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Push to `nexcraft main` only when the user asks.

---

## File structure

**Daemon**
- Create `daemon/src/service/fingerprint.ts` — CurseForge murmur2 fingerprint of mod jars.
- Create `daemon/src/service/server_detect.ts` — `detectServer(absDir)` (Java + Bedrock).
- Create `daemon/src/routers/import_router.ts` — `import/detect`, `import/finalize` socket events.
- Modify `daemon/src/service/modloader_bootstrap.ts` — extract shared `detectStartArtifact(...)`; add vanilla/Paper jar fallback.
- Modify `daemon/src/service/router.ts` — import the new router.

**Panel**
- Modify `panel/src/app/service/mod_manager_service.ts` — `matchCurseForgeFingerprints()`, `identifyPack()`.
- Create `panel/src/app/routers/import_router.ts` — proxy `import/detect` + `import/finalize`, add `import/identify`.
- Modify `panel/src/app/index.ts` — mount the router.
- Modify `panel/src/types/operation_logger.ts` — add `instance_import`.

**Frontend**
- Create `frontend/src/services/apis/import.ts` — API methods.
- Create `frontend/src/widgets/setupApp/ImportServerReview.vue` — review + mode-select dialog.
- Modify `frontend/src/widgets/setupApp/CreateInstanceForm.vue` — after the existing zip import creates the instance, open the review dialog.
- Modify `languages/en_US.json` — i18n keys.

---

## Task 1: Spike — verify CurseForge fingerprint endpoint via the proxy

**Files:** none (investigation; record the result in the commit message / a comment).

- [ ] **Step 1: Probe the proxy.** The codebase calls CurseForge through `api.curse.tools` (see `panel/src/app/service/mod_manager_service.ts`). Confirm whether it proxies `POST /v1/fingerprints`. Run (PowerShell):

```
curl -s -X POST "https://api.curse.tools/v1/cf/fingerprints" -H "Content-Type: application/json" --data "{\"fingerprints\":[123456789]}"
```

Also check the exact base path used in `mod_manager_service.ts` (it may be `https://api.curse.tools/v1/cf/...`). Try the matching `/fingerprints` and `/fingerprints/432` (432 = Minecraft gameId) shapes.

- [ ] **Step 2: Record the outcome.** Expected: a JSON body with `data.exactMatches`. 
  - If it works → fingerprinting is viable; proceed with Task 7 as written.
  - If it 404s/403s → **fingerprinting falls back to name-search only**; mark Task 7's fingerprint path as "best-effort, disabled" and rely on Modrinth-index + manifest name-search. Note this in the Task 7 implementation.
- [ ] **Step 3: Commit a note** (no code): add a one-line comment to the top of `panel/src/app/service/mod_manager_service.ts` recording whether `/fingerprints` is proxied, so the implementer of Task 7 knows. Commit `chore: record CF fingerprint endpoint availability`.

---

## Task 2: Extract shared start-command detection + vanilla/Paper fallback

**Files:**
- Modify: `daemon/src/service/modloader_bootstrap.ts` (the `detectStartFromExisting` method, ~lines 302–354)

- [ ] **Step 1: Add an exported pure function** at module scope (top-level, not a class method), so both the bootstrap and the new detector share it. It mirrors the current method body but takes its inputs as args and adds a vanilla/Paper fallback:

```ts
// Build a start command from already-present server artifacts. Pure/static so
// both ModloaderBootstrap and server_detect.ts use one source of truth.
export function detectStartArtifact(opts: {
  cwd: string;
  javaExe: string;
  memArgs: string;
  allowScripts?: boolean;
}): { startCommand: string; loader?: ModLoader } | undefined {
  const { cwd, javaExe, memArgs } = opts;
  const allowScripts = opts.allowScripts !== false;

  // Forge/NeoForge 1.17+ args files
  const argsName = os.platform() === "win32" ? "win_args.txt" : "unix_args.txt";
  const argsFile = findFile(path.join(cwd, "libraries"), argsName, 10);
  if (argsFile && fs.existsSync(path.join(cwd, "user_jvm_args.txt"))) {
    const rel = path.relative(cwd, argsFile).split(path.sep).join("/");
    const loader: ModLoader = /neoforge/i.test(rel) ? "neoforge" : "forge";
    return { startCommand: `${javaExe} ${memArgs} @user_jvm_args.txt @${rel} nogui`, loader };
  }

  // Start scripts shipped by the pack
  if (allowScripts) {
    const scripts =
      os.platform() === "win32"
        ? ["run.bat", "start.bat", "startserver.bat", "serverstart.bat"]
        : ["run.sh", "start.sh", "startserver.sh", "serverstart.sh"];
    for (const s of scripts) {
      const sp = path.join(cwd, s);
      if (fs.existsSync(sp)) {
        if (os.platform() !== "win32") {
          try {
            const content = fs.readFileSync(sp, "utf-8");
            if (content.includes("\r")) fs.writeFileSync(sp, content.replace(/\r\n/g, "\n"));
            fs.chmodSync(sp, 0o755);
          } catch {
            // ignore
          }
          return { startCommand: `bash ${s}` };
        }
        return { startCommand: s };
      }
    }
  }

  // Forge/NeoForge legacy universal/server jar
  const universal = findTopFile(cwd, /^(forge|neoforge)-.*\.jar$/i);
  if (universal && !/installer/i.test(path.basename(universal))) {
    const loader: ModLoader = /^neoforge/i.test(path.basename(universal)) ? "neoforge" : "forge";
    return { startCommand: `${javaExe} ${memArgs} -jar ${path.basename(universal)} nogui`, loader };
  }

  // Fabric / Quilt launch jars
  if (fs.existsSync(path.join(cwd, "fabric-server-launch.jar")))
    return { startCommand: `${javaExe} ${memArgs} -jar fabric-server-launch.jar nogui`, loader: "fabric" };
  if (fs.existsSync(path.join(cwd, "quilt-server-launch.jar")))
    return { startCommand: `${javaExe} ${memArgs} -jar quilt-server-launch.jar nogui`, loader: "quilt" };

  // NEW: vanilla / Paper / Purpur / Folia — a single runnable top-level jar.
  // Prefer the jar named in fabric-server-launcher.properties if present.
  const launcherProps = path.join(cwd, "fabric-server-launcher.properties");
  if (fs.existsSync(launcherProps)) {
    const m = /serverJar=(.+)/.exec(fs.readFileSync(launcherProps, "utf-8"));
    const jar = m?.[1]?.trim();
    if (jar && fs.existsSync(path.join(cwd, jar)))
      return { startCommand: `${javaExe} ${memArgs} -jar ${jar} nogui`, loader: "fabric" };
  }
  const serverJar =
    findTopFile(cwd, /^server\.jar$/i) ||
    findTopFile(cwd, /^paper-.*\.jar$/i) ||
    findTopFile(cwd, /^purpur-.*\.jar$/i) ||
    findTopFile(cwd, /^folia-.*\.jar$/i) ||
    findTopFile(cwd, /^(spigot|craftbukkit)-.*\.jar$/i);
  if (serverJar) {
    const base = path.basename(serverJar);
    let loader: ModLoader = "vanilla";
    if (/^paper/i.test(base)) loader = "paper";
    else if (/^purpur/i.test(base)) loader = "purpur";
    else if (/^folia/i.test(base)) loader = "folia";
    return { startCommand: `${javaExe} ${memArgs} -jar ${base} nogui`, loader };
  }

  return undefined;
}
```

- [ ] **Step 2: Make `detectStartFromExisting` delegate** to keep one implementation:

```ts
private detectStartFromExisting(allowScripts = true): string | undefined {
  return detectStartArtifact({
    cwd: this.cwd(),
    javaExe: this.startJava,
    memArgs: this.memArgs(),
    allowScripts
  })?.startCommand;
}
```

- [ ] **Step 3: Build.** Run: `npm run build --prefix daemon` — Expected: `compiled successfully`. (Confirms `findFile`, `findTopFile`, `ModLoader`, `os`, `path`, `fs` are already in scope — they are, since the original method used them.)
- [ ] **Step 4: Commit.** `git add daemon/src/service/modloader_bootstrap.ts && git commit` — message `daemon: extract detectStartArtifact + add vanilla/Paper jar fallback`.

---

## Task 3: CurseForge fingerprint utility

**Files:**
- Create: `daemon/src/service/fingerprint.ts`

- [ ] **Step 1: Implement CurseForge's murmur2.** CurseForge fingerprints a file by stripping whitespace bytes (`9, 10, 13, 32`) then running murmur2 (seed `1`). Hash each top-level mod jar in `mods/`.

```ts
import fs from "fs-extra";
import path from "path";

// CurseForge strips these bytes before hashing.
function stripWhitespace(buf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 9 || b === 10 || b === 13 || b === 32) continue;
    out[n++] = b;
  }
  return out.subarray(0, n);
}

// murmur2 (32-bit), CurseForge uses seed = 1.
function murmur2(data: Buffer, seed = 1): number {
  const m = 0x5bd1e995;
  const r = 24;
  let len = data.length;
  let h = (seed ^ len) >>> 0;
  let i = 0;
  while (len >= 4) {
    let k =
      (data[i] & 0xff) |
      ((data[i + 1] & 0xff) << 8) |
      ((data[i + 2] & 0xff) << 16) |
      ((data[i + 3] & 0xff) << 24);
    k = Math.imul(k, m) >>> 0;
    k = (k ^ (k >>> r)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    h = Math.imul(h, m) >>> 0;
    h = (h ^ k) >>> 0;
    i += 4;
    len -= 4;
  }
  if (len === 3) h = (h ^ ((data[i + 2] & 0xff) << 16)) >>> 0;
  if (len >= 2) h = (h ^ ((data[i + 1] & 0xff) << 8)) >>> 0;
  if (len >= 1) {
    h = (h ^ (data[i] & 0xff)) >>> 0;
    h = Math.imul(h, m) >>> 0;
  }
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, m) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

export function fingerprintFile(absPath: string): number {
  return murmur2(stripWhitespace(fs.readFileSync(absPath)));
}

// Fingerprint every top-level *.jar in <dir>/mods (CurseForge matching input).
export function fingerprintMods(instanceDir: string): number[] {
  const modsDir = path.join(instanceDir, "mods");
  if (!fs.existsSync(modsDir)) return [];
  const out: number[] = [];
  for (const name of fs.readdirSync(modsDir)) {
    if (!name.toLowerCase().endsWith(".jar")) continue;
    const p = path.join(modsDir, name);
    try {
      if (fs.statSync(p).isFile()) out.push(fingerprintFile(p));
    } catch {
      // ignore unreadable files
    }
  }
  return out;
}
```

- [ ] **Step 2: Build.** `npm run build --prefix daemon` — Expected: `compiled successfully`.
- [ ] **Step 3: Commit.** `daemon: add CurseForge murmur2 fingerprint util`.

---

## Task 4: `server_detect.ts` — detect an unpacked server folder

**Files:**
- Create: `daemon/src/service/server_detect.ts`

- [ ] **Step 1: Implement detection** (Java vs Bedrock, start command, loader, MC version, world name, manifest, fingerprints).

```ts
import fs from "fs-extra";
import path from "path";
import { detectStartArtifact } from "./modloader_bootstrap";
import { fingerprintMods } from "./fingerprint";
import type { ModLoader } from "./modloader_bootstrap";

export interface IServerDetectResult {
  kind: "java" | "bedrock";
  loader?: ModLoader;
  mcVersion?: string;
  startCommand?: string;
  worldName: string;
  manifest?: { source: "curseforge" | "modrinth"; raw: any };
  packName?: string;
  fingerprints?: number[];
}

function readProp(file: string, key: string): string | undefined {
  if (!fs.existsSync(file)) return undefined;
  const re = new RegExp(`^${key}=(.*)$`, "m");
  const m = re.exec(fs.readFileSync(file, "utf-8"));
  return m?.[1]?.trim();
}

// Top-level file finder (one level, case-insensitive exact name).
function hasTop(dir: string, name: string): boolean {
  return fs.existsSync(path.join(dir, name));
}

export function detectServer(dir: string): IServerDetectResult {
  // --- Bedrock first: a native bedrock_server binary at the top level. ---
  if (hasTop(dir, "bedrock_server")) {
    const worldName = readProp(path.join(dir, "server.properties"), "level-name") || "Bedrock level";
    try {
      fs.chmodSync(path.join(dir, "bedrock_server"), 0o755);
    } catch {
      // ignore
    }
    return {
      kind: "bedrock",
      loader: "bedrock" as ModLoader,
      worldName,
      startCommand: 'sh -c "LD_LIBRARY_PATH=. exec ./bedrock_server"'
    };
  }

  // --- Java ---
  const worldName = readProp(path.join(dir, "server.properties"), "level-name") || "world";
  const detected = detectStartArtifact({
    cwd: dir,
    javaExe: "java",
    memArgs: "-Xmx4096M -Xms1024M",
    allowScripts: true
  });

  const result: IServerDetectResult = {
    kind: "java",
    worldName,
    startCommand: detected?.startCommand,
    loader: detected?.loader,
    mcVersion: detectMcVersion(dir)
  };

  // Manifests (used by panel for pack identification).
  const cfManifest = path.join(dir, "manifest.json");
  if (fs.existsSync(cfManifest)) {
    try {
      const raw = fs.readJsonSync(cfManifest);
      result.manifest = { source: "curseforge", raw };
      result.packName = raw?.name;
    } catch {
      // ignore
    }
  }
  const mrIndex = path.join(dir, "modrinth.index.json");
  if (fs.existsSync(mrIndex)) {
    try {
      const raw = fs.readJsonSync(mrIndex);
      result.manifest = { source: "modrinth", raw };
      result.packName = raw?.name;
    } catch {
      // ignore
    }
  }

  result.fingerprints = fingerprintMods(dir);
  return result;
}

// Best-effort MC version sniff. Unknown -> undefined (user fills in review).
function detectMcVersion(dir: string): string | undefined {
  // 1) Vanilla-style versions/<v>/server-<v>.jar
  const versionsDir = path.join(dir, "versions");
  if (fs.existsSync(versionsDir)) {
    for (const v of fs.readdirSync(versionsDir)) {
      if (fs.existsSync(path.join(versionsDir, v, `server-${v}.jar`))) return v;
    }
  }
  // 2) Forge/NeoForge libraries path: net/minecraft/server/<mc>-<...>/
  const mcLib = path.join(dir, "libraries", "net", "minecraft", "server");
  if (fs.existsSync(mcLib)) {
    const entries = fs.readdirSync(mcLib);
    if (entries[0]) {
      const m = /^(\d+(?:\.\d+){1,2})/.exec(entries[0]);
      if (m) return m[1];
    }
  }
  return undefined;
}
```

- [ ] **Step 2: Build.** `npm run build --prefix daemon` — Expected: `compiled successfully`.
- [ ] **Step 3: Commit.** `daemon: add server_detect (java/bedrock loader + version + world + manifest)`.

---

## Task 5: Daemon `import_router.ts` — detect + finalize

**Files:**
- Create: `daemon/src/routers/import_router.ts`
- Modify: `daemon/src/service/router.ts` (add `import "../routers/import_router";` alongside the other router imports)

Read first: `daemon/src/routers/modpack_router.ts` (event/response pattern) and `daemon/src/service/async_task_service/modpack_install_task.ts:86-113` (how config + ports are set).

- [ ] **Step 1: Implement the router.** `import/detect` runs detection on an instance that the existing import flow already created+unpacked. `import/finalize` writes the chosen start command/type, runs `maybeFlatten`, accepts EULA, assigns a free port, and persists.

```ts
import fs from "fs-extra";
import path from "path";
import { $t } from "../i18n";
import { routerApp } from "../service/router";
import * as protocol from "../service/protocol";
import InstanceSubsystem from "../service/system_instance";
import { detectServer } from "../service/server_detect";
import { maybeFlatten } from "../service/modpack_files";
import { assignFreeBedrockPort, assignFreeMcPort } from "../service/mc_port";

routerApp.on("import/detect", async (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const dir = inst.absoluteCwdPath();
    maybeFlatten(dir); // collapse a single nested top dir (e.g. Crafty wrapper)
    protocol.response(ctx, detectServer(dir));
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

routerApp.on("import/finalize", async (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const dir = inst.absoluteCwdPath();
    const kind: "java" | "bedrock" = data.kind === "bedrock" ? "bedrock" : "java";

    inst.config.type = kind === "bedrock" ? "minecraft/bedrock" : "minecraft/java";
    inst.config.stopCommand = "stop";
    if (typeof data.startCommand === "string" && data.startCommand.trim())
      inst.config.startCommand = data.startCommand.trim();
    if (data.packInfo) inst.config.packInfo = data.packInfo;

    // EULA (Java won't boot without it).
    if (kind === "java") {
      try {
        fs.writeFileSync(path.join(dir, "eula.txt"), "eula=true\n");
      } catch {
        // ignore
      }
    }

    // Free, non-colliding port written into server.properties.
    try {
      if (kind === "bedrock") await assignFreeBedrockPort(inst);
      else await assignFreeMcPort(inst);
    } catch {
      // ignore — port assignment is best-effort
    }

    inst.forceExec(); // persist config (or use the same persistence call modpack tasks use)
    protocol.response(ctx, { instanceUuid: inst.instanceUuid });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});
```

> Implementer note: confirm the correct persistence call. `modpack_install_task` uses `instance.parameters({...}, true)` / `StorageSubsystem.store("InstanceConfig", uuid, config)`. Replace `inst.forceExec()` with the same `StorageSubsystem.store("InstanceConfig", inst.instanceUuid, inst.config)` used elsewhere (import `StorageSubsystem`). Verify `assignFreeMcPort`/`assignFreeBedrockPort` signatures from `daemon/src/service/mc_port.ts`.

- [ ] **Step 2: Register** in `daemon/src/service/router.ts`: add `import "../routers/import_router";` next to the existing `import "../routers/modpack_router";` line.
- [ ] **Step 3: Build.** `npm run build --prefix daemon` — Expected: `compiled successfully`.
- [ ] **Step 4: Commit.** `daemon: import_router (detect + finalize)`.

---

## Task 5b: Daemon hardening — `level-name` preserve + zip-slip safety

**Files:**
- Modify: `daemon/src/service/modpack_files.ts` (`shouldPreserve` and the extraction helper)

- [ ] **Step 1: `level-name` preserve.** Read `shouldPreserve(relPath, ...)` in `modpack_files.ts`. If it hardcodes `world*`, extend it to accept/look up the instance's actual world directory from `server.properties` `level-name` (default `world`), so a reinstall-with-`preserve_world` on an imported server keeps a non-`world` save. Match the existing call sites (`clearForReset` / `ModpackInstallTask` preserve path) — thread the world name through, or read `server.properties` inside the predicate. Keep the existing `world`/`world_nether`/`world_the_end`/`DIM*` coverage.
- [ ] **Step 2: Zip-slip check.** Confirm the extractor used by the existing Import Compressed Package flow (and `extractZipOverwrite` in `modpack_files.ts`) rejects entries containing `..` or absolute paths (zip-slip). If `extractZipOverwrite` doesn't already guard, add a check that each entry's resolved path stays within the destination dir; throw otherwise.
- [ ] **Step 3: Build.** `npm run build --prefix daemon` — Expected: `compiled successfully`.
- [ ] **Step 4: Commit.** `daemon: preserve honors level-name + zip-slip guard on extract`.

---

## Task 6: Panel — `matchCurseForgeFingerprints` + `identifyPack`

**Files:**
- Modify: `panel/src/app/service/mod_manager_service.ts`

Read first: the existing CurseForge call helper in this file (base URL, headers, how `getCurseForgeModpackVersions(modId)` is shaped) so the new methods reuse the same axios/proxy setup.

- [ ] **Step 1: Add fingerprint match** (only if Task 1 confirmed the endpoint; otherwise leave it returning `null` and rely on name-search). Use the file's existing CF base URL constant.

```ts
// Returns the matched modpack { modId, fileId } or null. Uses the same CF proxy
// base + headers as the other CurseForge calls in this file.
export async function matchCurseForgeFingerprints(
  hashes: number[]
): Promise<{ modId: number; fileId: number } | null> {
  if (!hashes.length) return null;
  try {
    const { data } = await axios.post(
      `${CF_BASE}/fingerprints`, // adjust to the file's actual CF base path
      { fingerprints: hashes },
      { timeout: 20000, headers: cfHeaders() }
    );
    const exact = data?.data?.exactMatches?.[0];
    if (exact?.file?.modId && exact?.file?.id)
      return { modId: exact.file.modId, fileId: exact.file.id };
  } catch {
    // endpoint unavailable / no match
  }
  return null;
}
```

- [ ] **Step 2: Add `identifyPack`** — strongest signal first; returns a normalized guess + version list. Reuse existing `getCurseForgeModpackVersions` and the Modrinth `getProjectVersions` helpers already in this file.

```ts
export interface IPackGuess {
  source: "curseforge" | "modrinth";
  projectId: string;
  projectName: string;
  versionLabel?: string;
  confidence: "high" | "low";
  versions: any[]; // same shape modpack browser already consumes
}

export async function identifyPack(detect: {
  fingerprints?: number[];
  manifest?: { source: "curseforge" | "modrinth"; raw: any };
  packName?: string;
}): Promise<IPackGuess | null> {
  // 1) CurseForge fingerprint (exact)
  const fp = await matchCurseForgeFingerprints(detect.fingerprints || []);
  if (fp) {
    const versions = await getCurseForgeModpackVersions(fp.modId);
    const name = versions?.[0]?.projectName || detect.packName || String(fp.modId);
    return { source: "curseforge", projectId: String(fp.modId), projectName: name, confidence: "high", versions };
  }
  // 2) Modrinth index: file URLs embed /data/<projectId>/versions/<versionId>/
  if (detect.manifest?.source === "modrinth") {
    const files: any[] = detect.manifest.raw?.files || [];
    const url: string | undefined = files.map((f) => (f?.downloads || [])[0]).find(Boolean);
    const m = url && /\/data\/([^/]+)\/versions\//.exec(url);
    if (m) {
      const versions = await getProjectVersions(m[1], "modrinth");
      return {
        source: "modrinth",
        projectId: m[1],
        projectName: detect.manifest.raw?.name || m[1],
        confidence: "high",
        versions
      };
    }
  }
  // 3) Name-search fallback (low confidence) — left for the implementer to wire
  //    using the existing searchProjects(query, {source, type:"modpack"}) helper
  //    if detect.packName is present; return the first match with confidence "low".
  return null;
}
```

> Note: the name-search fallback (step 3 in code) MUST be implemented using the existing `searchProjects(...)` in this file — search both CF and Modrinth for `detect.packName`, return the top modpack hit as `confidence: "low"`, else `null`. Do not leave it as a comment.

- [ ] **Step 3: Build.** `npm run build --prefix panel` — Expected: `compiled successfully`. (Watch ES2018: use `RegExp.exec`, not `matchAll`.)
- [ ] **Step 4: Commit.** `panel: CF fingerprint match + identifyPack`.

---

## Task 7: Panel — `import_router.ts` (proxy + identify) + mount + op log

**Files:**
- Create: `panel/src/app/routers/import_router.ts`
- Modify: `panel/src/app/index.ts` (mount, mirroring how `modpack_router` is mounted)
- Modify: `panel/src/types/operation_logger.ts` (add `instance_import`)

Read first: `panel/src/app/routers/modpack_router.ts` (permission/validator/`RemoteRequest` proxy pattern) and how routers are mounted in `index.ts`.

- [ ] **Step 1: Implement the router** (prefix `/protected_import`). `detect`/`finalize` proxy to the daemon; `identify` calls `identifyPack`.

```ts
import Router from "@koa/router";
import { RemoteRequest } from "../service/remote_request";
import RemoteServiceSubsystem from "../service/system_remote_service";
import permission from "../middleware/permission";
import validator from "../middleware/validator";
import { ROLE } from "../entity/user";
import { identifyPack } from "../service/mod_manager_service";

const router = new Router({ prefix: "/protected_import" });

router.post(
  "/detect",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String }, body: { instanceUuid: String } }),
  async (ctx) => {
    const { daemonId } = ctx.query as any;
    const remote = RemoteServiceSubsystem.getInstance(String(daemonId));
    ctx.body = await new RemoteRequest(remote).request("import/detect", {
      instanceUuid: ctx.request.body.instanceUuid
    });
  }
);

router.post("/identify", permission({ level: ROLE.ADMIN }), async (ctx) => {
  ctx.body = await identifyPack(ctx.request.body as any);
});

router.post(
  "/finalize",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String }, body: { instanceUuid: String, kind: String } }),
  async (ctx) => {
    const { daemonId } = ctx.query as any;
    const remote = RemoteServiceSubsystem.getInstance(String(daemonId));
    ctx.body = await new RemoteRequest(remote).request("import/finalize", ctx.request.body);
  }
);

export default router;
```

> Implementer note: match the exact import paths/middleware signatures used by `modpack_router.ts` (e.g. `RemoteRequest`, `RemoteServiceSubsystem`, `permission`, `validator`) — they may differ slightly from the names above.

- [ ] **Step 2: Mount** in `panel/src/app/index.ts` exactly like `modpack_router` is mounted.
- [ ] **Step 3: Operation logger** — add `instance_import: "Imported an existing server"` (or the established shape) to `panel/src/types/operation_logger.ts`.
- [ ] **Step 4: Build.** `npm run build --prefix panel` — Expected: `compiled successfully`.
- [ ] **Step 5: Commit.** `panel: import_router (detect/identify/finalize) + mount + op log`.

---

## Task 8: Frontend — `import.ts` API service

**Files:**
- Create: `frontend/src/services/apis/import.ts`

Read first: `frontend/src/services/apis/modpack.ts` (the `useDefineApi` shape, how `daemonId`/`instanceId` query params are passed).

- [ ] **Step 1: Implement** the three calls, mirroring `modpack.ts`:

```ts
import { useDefineApi } from "./index";

export const importDetect = useDefineApi<
  { params: { daemonId: string }; data: { instanceUuid: string } },
  any // IServerDetectResult shape from the daemon
>({ url: "/api/protected_import/detect", method: "POST" });

export const importIdentify = useDefineApi<{ data: any }, any /* IPackGuess | null */>({
  url: "/api/protected_import/identify",
  method: "POST"
});

export const importFinalize = useDefineApi<
  { params: { daemonId: string }; data: Record<string, any> },
  { instanceUuid: string }
>({ url: "/api/protected_import/finalize", method: "POST" });
```

- [ ] **Step 2: Type-check.** `npm run type-check --prefix frontend` — Expected: no errors.
- [ ] **Step 3: Commit.** `frontend: import API service`.

---

## Task 9: Frontend — `ImportServerReview.vue` review + mode dialog

**Files:**
- Create: `frontend/src/widgets/setupApp/ImportServerReview.vue`

Read first: `frontend/src/widgets/market/ModpackBrowser.vue` (Ant form + version dropdown + install-progress patterns) and `frontend/src/widgets/instance/ModpackUpdate.vue` (version select + reinstall trigger).

- [ ] **Step 1: Build the dialog.** Props: `{ daemonId: string; instanceUuid: string }`. On open, call `importDetect`, populate an editable form (instance name shown read-only; loader `a-select` — bind `undefined` not `null`; MC version `a-input`; **start command `a-textarea`**; max memory; detected world read-only). In parallel call `importIdentify` with the detect result; show the pack guess + a version `a-select` if non-null.
- [ ] **Step 2: Mode buttons.**
  - **Import as-is** (always): disabled unless the start-command field is non-empty (Java). Calls `importFinalize` with `{ instanceUuid, kind, startCommand }`.
  - **Link to pack** (only if guess): calls `importFinalize` with `{ instanceUuid, kind, startCommand, packInfo }` where `packInfo` is built from the chosen version (mirror the `packInfo` shape `ModpackBrowser`/install uses).
  - **Reinstall fresh + keep world** (only if guess): calls the existing modpack reinstall API with `resetMode: "preserve_world"` and the descriptor for the chosen version (reuse the install descriptor builder from `ModpackBrowser`), then polls `modpackTaskStatus`. Show the "auto-backup first; world & settings preserved" note.
- [ ] **Step 3: On success**, emit `done` with the `instanceUuid`; the parent routes to the instance terminal.
- [ ] **Step 4: Type-check.** `npm run type-check --prefix frontend` — Expected: no errors.
- [ ] **Step 5: Commit.** `frontend: ImportServerReview dialog`.

---

## Task 10: Frontend — wire the wizard into the existing zip import

**Files:**
- Modify: `frontend/src/widgets/setupApp/CreateInstanceForm.vue`

Read first: the current **Import Compressed Package** branch in this file — find where the existing zip upload completes and the new instance is created (it already returns/knows the new `instanceUuid` + `daemonId`).

- [ ] **Step 1:** After the existing import-compressed-package upload **successfully creates the instance**, instead of (or in addition to) the current "go to instance" behavior, open `ImportServerReview` with `{ daemonId, instanceUuid }`. Keep the existing path as a fallback if the user closes the dialog.
- [ ] **Step 2:** On the dialog's `done`, route to the instance terminal (reuse the existing post-create navigation in this file).
- [ ] **Step 3: Type-check.** `npm run type-check --prefix frontend` — Expected: no errors.
- [ ] **Step 4: Commit.** `frontend: open import review after zip import`.

---

## Task 11: i18n keys

**Files:**
- Modify: `languages/en_US.json`

- [ ] **Step 1:** Add keys used by the dialog (frontend `{var}` style). Include at least: title, "Detected", loader, Minecraft version, start command, world, "No pack identified", "Looks like {name} ({source})", the three mode button labels, and the reinstall safety note. Place them near the other modpack keys; en_US.json is the source of truth.
- [ ] **Step 2: Validate JSON.** Run: `node -e "JSON.parse(require('fs').readFileSync('languages/en_US.json','utf8'));console.log('ok')"` — Expected: `ok`.
- [ ] **Step 3: Build web** (languages are bundled): `npm run build --prefix panel` — Expected: `compiled successfully`.
- [ ] **Step 4: Commit.** `i18n: import-server wizard strings`.

---

## Task 12: Full type-check + build sweep

- [ ] **Step 1:** `npm run build --prefix daemon` → `compiled successfully`.
- [ ] **Step 2:** `npm run build --prefix panel` → `compiled successfully`.
- [ ] **Step 3:** `npm run type-check --prefix frontend` → no errors.
- [ ] **Step 4:** `npm run build --prefix frontend` → builds.
- [ ] **Step 5: Commit** any fixups. `chore: typecheck/build sweep for import feature`.

---

## Task 13: Manual verification (the real gate)

Deploy (publish workflow → update both Unraid containers → hard-refresh), then run the matrix. Each row: **Minecraft → Import → upload the zip → review screen → finalize → server runs.**

- [ ] Vanilla server zip → start command detects `server.jar`; runs.
- [ ] Paper zip → detects `paper-*.jar`; runs.
- [ ] Forge (1.17+) pack zip → detects args-file start; runs.
- [ ] Fabric pack zip → detects `fabric-server-launch.jar`; runs.
- [ ] Bedrock zip (`bedrock_server` + `worlds/`) → bedrock type + start; runs; UDP port assigned.
- [ ] CurseForge modpack export → pack identified (fingerprint); **Reinstall + keep world** → world preserved, Update card appears, server runs.
- [ ] Modrinth-derived server (with `modrinth.index.json`) → project identified.
- [ ] "Zip of a running server", no manifest → fingerprint or name-search; if unidentified, Import-as-is with editable start.
- [ ] Unknown/garbage zip → instance created, start command blank, finalize blocked until filled; no crash.
- [ ] Non-admin user → import endpoints blocked.
- [ ] Crafty backup zip (timestamped wrapper folder) → `maybeFlatten` collapses it; detection works.

---

## Notes carried from the spec
- Reinstall preserves only world + player/server settings (fresh pack mods+config). The `level-name` handling is **Task 5b**.
- Fingerprint endpoint availability is decided in Task 1; name-search is the guaranteed fallback.
- Big multi-GB zips: accepted slow-upload tradeoff (zip-only source).
