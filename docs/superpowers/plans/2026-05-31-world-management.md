# World Management (#15) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an admin a per-instance "World Management" card to view, download, replace/restore, and reset an instance's single active world, with an automatic world-only safety backup before destructive operations.

**Architecture:** A new daemon `world_service.ts` provides pure helpers (locate/zip/wipe/place the active world, world-only backup into the existing Backups area). Two `AsyncTask`s (`WorldReplaceTask`, `WorldResetTask`) orchestrate stop → backup → mutate → restart, modeled on `RestoreTask`/`ModpackUpdateTask`. A daemon `world_router.ts` exposes socket actions; a panel `world_router.ts` (`/protected_world`, admin-gated) proxies them via `RemoteRequest`. Download reuses the existing signed-token `/download/:key/:fileName` route + `passport/register`; replace reuses the existing chunked-upload transport (`/api/files/upload`). The frontend adds `World.vue` + an API module + the four standard registrations + a nav button.

**Tech Stack:** TypeScript, Koa, socket.io (daemon RPC), `archiver` (zip), `node-stream-zip` (extract), `fs-extra`, Vue 3 + Ant Design Vue + vue-i18n.

---

## ⚠️ Project conventions that OVERRIDE the writing-plans defaults

- **No unit-test runner exists** in `daemon/` or `panel/` (only `build` = webpack/tsc). Per `CLAUDE.md`, the verification gate is **type-check (`npm run build`) + Docker build + manual testing on the Test stack** — NOT a test framework. So tasks below use **type-check as the per-task gate**, plus a manual verification checklist at the end (Task 9). Do **not** introduce a test framework.
- **PowerShell gotcha (run before EVERY build command):**
  ```powershell
  $env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
  ```
- **Build commands:** daemon `npm run build --prefix daemon` · panel `npm run build --prefix panel` (also compiles daemon — panel bundles daemon source) · frontend type-check `npm run type-check --prefix frontend`.
- **Commit messages end with:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Host/general process mode only** (no Docker instances) — consistent with the rest of NexCraft.

---

## File Structure

**New files:**
- `daemon/src/service/world_service.ts` — pure helpers + world-only backup/zip/wipe/place.
- `daemon/src/service/async_task_service/world_replace_task.ts` — `WorldReplaceTask` (AsyncTask).
- `daemon/src/service/async_task_service/world_reset_task.ts` — `WorldResetTask` (AsyncTask).
- `daemon/src/routers/world_router.ts` — socket actions `world/info|prepare_download|replace|reset|task_status`.
- `panel/src/app/routers/world_router.ts` — `/protected_world` proxy (admin-gated).
- `frontend/src/services/apis/world.ts` — `worldInfo|worldDownloadAddress|worldReplace|worldReset|worldTaskStatus`.
- `frontend/src/widgets/instance/World.vue` — the card.

**Modified files:**
- `languages/en_US.json` — i18n keys (source of truth).
- `daemon/src/service/router.ts` — add `import "../routers/world_router";`.
- `panel/src/types/operation_logger.ts` — add `instance_world_replace` / `instance_world_reset`.
- `panel/src/app/index.ts` — mount `worldRouter`.
- `frontend/src/config/index.ts` — register `InstanceWorld` card.
- `frontend/src/config/router.ts` — register `/instances/world` route.
- `panel/src/app/service/frontend_layout.ts` — default page for `/instances/world`.
- `frontend/src/widgets/instance/ManagerBtns.vue` — nav button.

---

## Task 1: Branch + i18n keys

**Files:**
- Modify: `languages/en_US.json`

- [ ] **Step 1: Create the feature branch off the current branch**

The import work (`feat/import-existing-server`) is not yet merged to `main` and touches the same registration files this feature edits (`config/index.ts`, `config/router.ts`, `frontend_layout.ts`, `ManagerBtns.vue`, `operation_logger.ts`, `panel/app/index.ts`). Branch off it to avoid double-editing/conflicts.

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
git checkout feat/import-existing-server
git pull --ff-only origin feat/import-existing-server
git checkout -b feat/world-management
```

- [ ] **Step 2: Add the daemon-side i18n keys (use `{{var}}` interpolation)**

In `languages/en_US.json`, add a top-level `"TXT_CODE_world"` object (alongside the existing `"TXT_CODE_backup"` object — daemon keys are dot-nested). Insert:

```json
  "TXT_CODE_world": {
    "noLevelDat": "No level.dat found in the uploaded archive. Make sure it contains a Minecraft world.",
    "noWorld": "No active world folder was found for this instance.",
    "replaceStart": "Replacing the active world...",
    "resetStart": "Resetting the active world...",
    "backup": "Backing up the current world...",
    "stopping": "Stopping the server before modifying the world...",
    "extracting": "Extracting the uploaded world...",
    "placing": "Installing the new world...",
    "done": "World operation complete.",
    "failedStopped": "World operation failed; the server was left stopped. Restore from Backups if needed.",
    "stopTimeout": "Timed out waiting for the server to stop."
  },
```

- [ ] **Step 3: Add the frontend-side i18n keys (flat `TXT_CODE_world_*`, `{var}` interpolation)**

In `languages/en_US.json`, add these flat keys (mirror the existing flat `TXT_CODE_modpack_update_*` keys' location):

```json
  "TXT_CODE_world_card_title": "World Management",
  "TXT_CODE_world_card_desc": "View, download, replace, or reset this server's active world.",
  "TXT_CODE_world_current": "Current World",
  "TXT_CODE_world_name": "World name",
  "TXT_CODE_world_type": "Type",
  "TXT_CODE_world_size": "Size",
  "TXT_CODE_world_modified": "Last modified",
  "TXT_CODE_world_none": "No active world yet. Start the server once to generate it.",
  "TXT_CODE_world_download": "Download world",
  "TXT_CODE_world_download_hint_java": "Downloads the world (overworld + nether + end) as a .zip.",
  "TXT_CODE_world_download_hint_bedrock": "Downloads the world as a .mcworld (opens in Minecraft: Bedrock Edition).",
  "TXT_CODE_world_replace": "Replace world",
  "TXT_CODE_world_replace_hint": "Upload a world archive to replace the current one. The current world is backed up first.",
  "TXT_CODE_world_replace_confirm_title": "Replace the active world?",
  "TXT_CODE_world_replace_confirm": "This stops the server, backs up the current world to Backups, then replaces it with your upload. Continue?",
  "TXT_CODE_world_reset": "Reset world",
  "TXT_CODE_world_reset_hint": "Delete the world so the server regenerates a fresh one on next start. The current world is backed up first.",
  "TXT_CODE_world_reset_confirm_title": "Reset the active world?",
  "TXT_CODE_world_reset_confirm": "This stops the server, backs up the current world to Backups, then deletes it. A fresh world is generated on next start. Continue?",
  "TXT_CODE_world_select_file": "Select a world archive (.zip / .mcworld)",
  "TXT_CODE_world_uploading": "Uploading world archive...",
  "TXT_CODE_world_task_running": "Working - do not close this page...",
  "TXT_CODE_world_task_replace_done": "World replaced. A backup of the previous world was saved to Backups.",
  "TXT_CODE_world_task_reset_done": "World reset. A backup of the previous world was saved to Backups.",
  "TXT_CODE_world_task_failed": "World operation failed. Check the instance console; restore from Backups if needed.",
```

- [ ] **Step 4: Validate JSON**

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
node -e "JSON.parse(require('fs').readFileSync('languages/en_US.json','utf8')); console.log('en_US.json OK')"
```
Expected: `en_US.json OK`

- [ ] **Step 5: Commit**

```powershell
git add languages/en_US.json
git commit -m @'
feat(world): add World Management i18n keys (en_US source of truth)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 2: Daemon `world_service.ts` (pure helpers + backup/zip/wipe/place)

**Files:**
- Create: `daemon/src/service/world_service.ts`

Reuses `readLevelName` from `modpack_files.ts`, `backupDir` from `backup_service.ts`, `archiver`, `node-stream-zip`, `fs-extra`.

- [ ] **Step 1: Create the file with full content**

```typescript
import archiver from "archiver";
import fs from "fs-extra";
import path from "path";
import Instance from "../entity/instance/instance";
import { $t } from "../i18n";
import { backupDir } from "./backup_service";
import { readLevelName } from "./modpack_files";

export type WorldKind = "java" | "bedrock";

// Temp dirs (under the instance cwd). Dot-prefixed so they sort out of the way and
// match the project's existing convention (cf. .mcsm_update_stage in ModpackUpdateTask).
export const WORLD_UPLOAD_DIR = ".nexcraft_world_up";
export const WORLD_EXTRACT_DIR = ".nexcraft_world_extract";
export const WORLD_DOWNLOAD_DIR = ".nexcraft_world_dl";

export function getWorldKind(instance: Instance): WorldKind {
  return String(instance.config?.type || "").includes("bedrock") ? "bedrock" : "java";
}

// World top-level folders RELATIVE TO cwd, only those that exist.
//  Java:    <level-name>, <level-name>_nether, <level-name>_the_end
//           (modded dimensions nest inside <level-name>/DIM*, so they ride along).
//  Bedrock: worlds/<level-name>
export function getActiveWorldPaths(cwd: string, kind: WorldKind, levelName: string): string[] {
  if (kind === "bedrock") {
    const rel = path.posix.join("worlds", levelName);
    return fs.existsSync(path.join(cwd, "worlds", levelName)) ? [rel] : [];
  }
  const candidates = [levelName, `${levelName}_nether`, `${levelName}_the_end`];
  return candidates.filter((rel) => fs.existsSync(path.join(cwd, rel)));
}

// Locate the directory containing level.dat (the world root) within an extracted
// upload. BFS with a depth cap so a deeply/oddly nested archive still resolves.
export function findWorldRoot(dir: string): string | undefined {
  const queue: Array<{ d: string; depth: number }> = [{ d: dir, depth: 0 }];
  while (queue.length) {
    const { d, depth } = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((e) => e.isFile() && e.name === "level.dat")) return d;
    if (depth >= 6) continue;
    for (const e of entries) {
      if (e.isDirectory()) queue.push({ d: path.join(d, e.name), depth: depth + 1 });
    }
  }
  return undefined;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_") || "world";
}

// Browser-suggested download filename. Java -> <level>.zip, Bedrock -> <level>.mcworld
export function worldDownloadFileName(kind: WorldKind, levelName: string): string {
  const base = sanitizeFileName(levelName);
  return kind === "bedrock" ? `${base}.mcworld` : `${base}.zip`;
}

function worldTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
}

async function dirSizeAndMtime(absDir: string): Promise<{ size: number; mtimeMs: number }> {
  let size = 0;
  let mtimeMs = 0;
  const walk = async (p: string) => {
    let stat: fs.Stats;
    try {
      stat = await fs.stat(p);
    } catch {
      return;
    }
    mtimeMs = Math.max(mtimeMs, stat.mtimeMs);
    if (stat.isDirectory()) {
      const names = await fs.readdir(p);
      for (const n of names) await walk(path.join(p, n));
    } else {
      size += stat.size;
    }
  };
  await walk(absDir);
  return { size, mtimeMs };
}

export interface IWorldInfo {
  levelName: string;
  kind: WorldKind;
  exists: boolean;
  size: number;
  lastModified: number;
}

export async function getWorldInfo(instance: Instance): Promise<IWorldInfo> {
  const cwd = instance.absoluteCwdPath();
  const kind = getWorldKind(instance);
  const levelName = readLevelName(cwd);
  const rels = getActiveWorldPaths(cwd, kind, levelName);
  let size = 0;
  let lastModified = 0;
  for (const rel of rels) {
    const { size: s, mtimeMs } = await dirSizeAndMtime(path.join(cwd, rel));
    size += s;
    lastModified = Math.max(lastModified, mtimeMs);
  }
  return { levelName, kind, exists: rels.length > 0, size, lastModified };
}

// Helper: zip a set of absolute folders into destZip.
//  entries[].name === false  -> that folder's CONTENTS are placed at the zip root
//  entries[].name === string -> that folder is nested under the given relative name
function zipFolders(
  entries: Array<{ abs: string; name: string | false }>,
  destZip: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(destZip);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("warning", (err: any) => {
      if (err?.code !== "ENOENT") reject(err);
    });
    archive.on("error", reject);
    archive.pipe(output);
    for (const e of entries) archive.directory(e.abs, e.name as any);
    archive.finalize().catch(reject);
  });
}

// Build a downloadable world archive.
//  Java:    each world folder kept at its relative name (world/, world_nether/, ...).
//  Bedrock: contents of worlds/<level> placed at the zip root (a valid .mcworld).
export async function zipWorld(
  cwd: string,
  kind: WorldKind,
  levelName: string,
  destZip: string
): Promise<void> {
  const rels = getActiveWorldPaths(cwd, kind, levelName);
  if (rels.length === 0) throw new Error($t("TXT_CODE_world.noWorld"));
  await fs.ensureDir(path.dirname(destZip));
  if (kind === "bedrock") {
    await zipFolders([{ abs: path.join(cwd, rels[0]), name: false }], destZip);
  } else {
    await zipFolders(rels.map((rel) => ({ abs: path.join(cwd, rel), name: rel })), destZip);
  }
}

// World-ONLY backup into the existing Backups area. Entries keep their relative
// paths (Java: world/..., world_nether/...; Bedrock: worlds/<level>/...) so the
// archive is restore-compatible with the Backups card / RestoreTask (which
// extracts straight into cwd). Named world-<ts>.zip to distinguish from full
// backup-<ts>.zip. Returns the absolute path, or undefined if there is no world.
export async function backupActiveWorld(instance: Instance): Promise<string | undefined> {
  const cwd = instance.absoluteCwdPath();
  const kind = getWorldKind(instance);
  const levelName = readLevelName(cwd);
  const rels = getActiveWorldPaths(cwd, kind, levelName);
  if (rels.length === 0) return undefined;
  const dir = backupDir(instance.instanceUuid);
  await fs.ensureDir(dir);
  const dest = path.join(dir, `world-${worldTimestamp()}.zip`);
  await zipFolders(rels.map((rel) => ({ abs: path.join(cwd, rel), name: rel })), dest);
  return dest;
}

export async function wipeActiveWorld(
  cwd: string,
  kind: WorldKind,
  levelName: string
): Promise<void> {
  for (const rel of getActiveWorldPaths(cwd, kind, levelName)) {
    await fs.remove(path.join(cwd, rel));
  }
}

// Install an uploaded world (srcRoot = the dir that contains level.dat) at the
// active level-name location.
//  Bedrock: copy srcRoot contents into worlds/<level>/.
//  Java:    copy srcRoot contents into <level>/, and any sibling _nether/_the_end
//           dimension folders into <level>_nether / <level>_the_end.
export async function placeWorld(
  srcRoot: string,
  cwd: string,
  kind: WorldKind,
  levelName: string
): Promise<void> {
  if (kind === "bedrock") {
    const dest = path.join(cwd, "worlds", levelName);
    await fs.ensureDir(dest);
    await fs.copy(srcRoot, dest, { overwrite: true });
    return;
  }
  const dest = path.join(cwd, levelName);
  await fs.ensureDir(dest);
  await fs.copy(srcRoot, dest, { overwrite: true });

  const parent = path.dirname(srcRoot);
  const baseName = path.basename(srcRoot);
  for (const suffix of ["_nether", "_the_end"] as const) {
    const sib = path.join(parent, `${baseName}${suffix}`);
    if (fs.existsSync(sib)) {
      const d = path.join(cwd, `${levelName}${suffix}`);
      await fs.ensureDir(d);
      await fs.copy(sib, d, { overwrite: true });
    }
  }
}
```

- [ ] **Step 2: Type-check the daemon**

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
```
Expected: webpack build completes with no TypeScript errors. (If `archiver`'s `.directory(dir, false)` complains about the `false` literal type, the `name as any` cast in `zipFolders` already handles it.)

- [ ] **Step 3: Smoke-test the pure helpers (no test framework — throwaway ts-node script)**

Create a temp script and run it; it exercises `findWorldRoot`, `getActiveWorldPaths`, and `worldDownloadFileName` against fixtures, then deletes itself.

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
@'
import fs from "fs-extra";
import path from "path";
import os from "os";
import { findWorldRoot, getActiveWorldPaths, worldDownloadFileName } from "./src/service/world_service";

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wm-"));
  // nested world: <root>/export/world/level.dat
  await fs.ensureDir(path.join(root, "export", "world"));
  await fs.writeFile(path.join(root, "export", "world", "level.dat"), "x");
  const found = findWorldRoot(root);
  console.assert(found === path.join(root, "export", "world"), "findWorldRoot nested FAILED:", found);

  // java active world set
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cwd-"));
  await fs.ensureDir(path.join(cwd, "world"));
  await fs.ensureDir(path.join(cwd, "world_nether"));
  const rels = getActiveWorldPaths(cwd, "java", "world");
  console.assert(JSON.stringify(rels) === JSON.stringify(["world", "world_nether"]), "getActiveWorldPaths FAILED:", rels);

  console.assert(worldDownloadFileName("bedrock", "Bedrock level") === "Bedrock_level.mcworld", "bedrock name FAILED");
  console.assert(worldDownloadFileName("java", "world") === "world.zip", "java name FAILED");

  await fs.remove(root); await fs.remove(cwd);
  console.log("world_service helpers OK");
})();
'@ | Out-File -Encoding utf8 daemon/_wm_smoke.ts
npx --prefix daemon ts-node -P daemon/tsconfig.json daemon/_wm_smoke.ts
Remove-Item daemon/_wm_smoke.ts
```
Expected: `world_service helpers OK` with no assertion warnings. (If `ts-node` path resolution fails in this monorepo, skip this step — the daemon type-check in Step 2 is the binding gate; note the skip in the task report.)

- [ ] **Step 4: Commit**

```powershell
git add daemon/src/service/world_service.ts
git commit -m @'
feat(world): daemon world_service helpers (locate/zip/wipe/place + world backup)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 3: Daemon async tasks (`WorldReplaceTask`, `WorldResetTask`)

**Files:**
- Create: `daemon/src/service/async_task_service/world_replace_task.ts`
- Create: `daemon/src/service/async_task_service/world_reset_task.ts`

Modeled on `RestoreTask` (`daemon/src/service/async_task_service/restore_task.ts`) and `ModpackUpdateTask`.

- [ ] **Step 1: Create `world_replace_task.ts`**

```typescript
import fs from "fs-extra";
import StreamZip from "node-stream-zip";
import path from "path";
import { v4 } from "uuid";
import Instance from "../../entity/instance/instance";
import { $t } from "../../i18n";
import { sleep } from "../../utils/sleep";
import logger from "../log";
import { readLevelName } from "../modpack_files";
import {
  WORLD_EXTRACT_DIR,
  WORLD_UPLOAD_DIR,
  backupActiveWorld,
  findWorldRoot,
  getActiveWorldPaths,
  getWorldKind,
  placeWorld,
  wipeActiveWorld
} from "../world_service";
import { AsyncTask, IAsyncTaskJSON } from "./index";

export class WorldReplaceTask extends AsyncTask {
  public static TYPE = "WorldReplaceTask";
  public phase: "backup" | "stop" | "extract" | "apply" | "done" = "backup";

  // hintFileName: the basename the frontend uploaded into WORLD_UPLOAD_DIR.
  constructor(public instance: Instance, public hintFileName: string) {
    super();
    this.taskId = `${WorldReplaceTask.TYPE}-${instance.instanceUuid}-${v4()}`;
    this.type = WorldReplaceTask.TYPE;
  }

  private async waitForStop(timeoutMs = 5 * 60 * 1000) {
    const start = Date.now();
    while (this.instance.status() !== Instance.STATUS_STOP) {
      if (Date.now() - start > timeoutMs) throw new Error($t("TXT_CODE_world.stopTimeout"));
      await sleep(500);
    }
  }

  // Resolve the uploaded archive: prefer the exact hinted name, else newest
  // .zip/.mcworld in the upload dir (in case the upload transport renamed it).
  private resolveArchive(uploadDir: string): string {
    const exact = path.join(uploadDir, this.hintFileName);
    if (this.hintFileName && fs.existsSync(exact) && fs.statSync(exact).isFile()) return exact;
    let candidates: Array<{ p: string; t: number }> = [];
    try {
      candidates = fs
        .readdirSync(uploadDir)
        .filter((n) => /\.(zip|mcworld)$/i.test(n))
        .map((n) => ({ p: path.join(uploadDir, n), t: fs.statSync(path.join(uploadDir, n)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
    } catch {
      // dir missing
    }
    if (candidates.length === 0) throw new Error($t("TXT_CODE_world.noLevelDat"));
    return candidates[0].p;
  }

  async onStart() {
    const inst = this.instance;
    const cwd = inst.absoluteCwdPath();
    const kind = getWorldKind(inst);
    const levelName = readLevelName(cwd);
    const uploadDir = path.join(cwd, WORLD_UPLOAD_DIR);
    const extractDir = path.join(cwd, WORLD_EXTRACT_DIR);
    const status = inst.status();
    if (status === Instance.STATUS_BUSY || status === Instance.STATUS_STARTING) {
      this.error(new Error($t("TXT_CODE_backup.busy")));
      return;
    }
    const wasRunning = status === Instance.STATUS_RUNNING;
    let succeeded = false;

    try {
      const archive = this.resolveArchive(uploadDir);
      inst.println("INFO", $t("TXT_CODE_world.replaceStart"));

      // 1) Stop the server (mutating a live world is unsafe).
      if (wasRunning) {
        this.phase = "stop";
        inst.println("INFO", $t("TXT_CODE_world.stopping"));
        await inst.execPreset("stop");
        await this.waitForStop();
      }
      inst.status(Instance.STATUS_BUSY);

      // 2) World-only safety backup (skip if there is no world yet).
      this.phase = "backup";
      if (getActiveWorldPaths(cwd, kind, levelName).length > 0) {
        inst.println("INFO", $t("TXT_CODE_world.backup"));
        await backupActiveWorld(inst);
      }

      // 3) Extract the upload and detect the world root.
      this.phase = "extract";
      inst.println("INFO", $t("TXT_CODE_world.extracting"));
      await fs.remove(extractDir);
      await fs.ensureDir(extractDir);
      const zip = new StreamZip.async({ file: archive });
      try {
        await zip.extract(null, extractDir);
      } finally {
        await zip.close();
      }
      const root = findWorldRoot(extractDir);
      if (!root) throw new Error($t("TXT_CODE_world.noLevelDat"));

      // 4) Wipe the active world, then install the uploaded one.
      this.phase = "apply";
      inst.println("INFO", $t("TXT_CODE_world.placing"));
      await wipeActiveWorld(cwd, kind, levelName);
      await placeWorld(root, cwd, kind, levelName);

      succeeded = true;
      this.phase = "done";
      inst.println("INFO", $t("TXT_CODE_world.done"));
    } catch (error: any) {
      inst.status(Instance.STATUS_STOP);
      this.error(error);
      return;
    } finally {
      await fs.remove(extractDir).catch(() => {});
      await fs.remove(uploadDir).catch(() => {});
      if (inst.status() === Instance.STATUS_BUSY) inst.status(Instance.STATUS_STOP);
      // Restart only on success: a mid-apply failure may have wiped the world
      // (the safety backup is the recovery path), so do not relaunch onto it.
      if (wasRunning && succeeded) {
        try {
          await inst.execPreset("start");
        } catch {
          // ignore restart failure
        }
      } else if (wasRunning && !succeeded) {
        inst.println("WARN", $t("TXT_CODE_world.failedStopped"));
      }
    }
    this.stop();
  }

  async onStop() {}

  async onError(err: Error) {
    logger.error(`WorldReplaceTask error: ${err?.message}`);
    this.instance.println("ERROR", err?.message);
  }

  toObject(): IAsyncTaskJSON {
    return JSON.parse(
      JSON.stringify({
        taskId: this.taskId,
        status: this.status(),
        instanceUuid: this.instance.instanceUuid,
        instanceStatus: this.instance.status(),
        phase: this.phase
      })
    );
  }
}
```

- [ ] **Step 2: Create `world_reset_task.ts`**

```typescript
import { v4 } from "uuid";
import Instance from "../../entity/instance/instance";
import { $t } from "../../i18n";
import { sleep } from "../../utils/sleep";
import logger from "../log";
import { readLevelName } from "../modpack_files";
import { backupActiveWorld, getActiveWorldPaths, getWorldKind, wipeActiveWorld } from "../world_service";
import { AsyncTask, IAsyncTaskJSON } from "./index";

export class WorldResetTask extends AsyncTask {
  public static TYPE = "WorldResetTask";
  public phase: "backup" | "stop" | "wipe" | "done" = "backup";

  constructor(public instance: Instance) {
    super();
    this.taskId = `${WorldResetTask.TYPE}-${instance.instanceUuid}-${v4()}`;
    this.type = WorldResetTask.TYPE;
  }

  private async waitForStop(timeoutMs = 5 * 60 * 1000) {
    const start = Date.now();
    while (this.instance.status() !== Instance.STATUS_STOP) {
      if (Date.now() - start > timeoutMs) throw new Error($t("TXT_CODE_world.stopTimeout"));
      await sleep(500);
    }
  }

  async onStart() {
    const inst = this.instance;
    const cwd = inst.absoluteCwdPath();
    const kind = getWorldKind(inst);
    const levelName = readLevelName(cwd);
    const status = inst.status();
    if (status === Instance.STATUS_BUSY || status === Instance.STATUS_STARTING) {
      this.error(new Error($t("TXT_CODE_backup.busy")));
      return;
    }
    const wasRunning = status === Instance.STATUS_RUNNING;
    let succeeded = false;

    try {
      inst.println("INFO", $t("TXT_CODE_world.resetStart"));

      // 1) Stop.
      if (wasRunning) {
        this.phase = "stop";
        inst.println("INFO", $t("TXT_CODE_world.stopping"));
        await inst.execPreset("stop");
        await this.waitForStop();
      }
      inst.status(Instance.STATUS_BUSY);

      // 2) World-only safety backup (skip if no world yet).
      this.phase = "backup";
      if (getActiveWorldPaths(cwd, kind, levelName).length > 0) {
        inst.println("INFO", $t("TXT_CODE_world.backup"));
        await backupActiveWorld(inst);
      }

      // 3) Remove the active world; the server regenerates it on next start.
      this.phase = "wipe";
      await wipeActiveWorld(cwd, kind, levelName);

      succeeded = true;
      this.phase = "done";
      inst.println("INFO", $t("TXT_CODE_world.done"));
    } catch (error: any) {
      inst.status(Instance.STATUS_STOP);
      this.error(error);
      return;
    } finally {
      if (inst.status() === Instance.STATUS_BUSY) inst.status(Instance.STATUS_STOP);
      if (wasRunning && succeeded) {
        try {
          await inst.execPreset("start");
        } catch {
          // ignore restart failure
        }
      } else if (wasRunning && !succeeded) {
        inst.println("WARN", $t("TXT_CODE_world.failedStopped"));
      }
    }
    this.stop();
  }

  async onStop() {}

  async onError(err: Error) {
    logger.error(`WorldResetTask error: ${err?.message}`);
    this.instance.println("ERROR", err?.message);
  }

  toObject(): IAsyncTaskJSON {
    return JSON.parse(
      JSON.stringify({
        taskId: this.taskId,
        status: this.status(),
        instanceUuid: this.instance.instanceUuid,
        instanceStatus: this.instance.status(),
        phase: this.phase
      })
    );
  }
}
```

- [ ] **Step 3: Type-check the daemon**

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
```
Expected: no TypeScript errors. (If `$t("TXT_CODE_backup.busy")` / `"TXT_CODE_backup.stopTimeout"` keys are missing, they already exist — used by `RestoreTask`. `TXT_CODE_world.*` were added in Task 1.)

- [ ] **Step 4: Commit**

```powershell
git add daemon/src/service/async_task_service/world_replace_task.ts daemon/src/service/async_task_service/world_reset_task.ts
git commit -m @'
feat(world): WorldReplaceTask + WorldResetTask (stop -> world-backup -> mutate -> restart)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 4: Daemon `world_router.ts` + registration

**Files:**
- Create: `daemon/src/routers/world_router.ts`
- Modify: `daemon/src/service/router.ts` (add the import)

- [ ] **Step 1: Create `world_router.ts`**

Note: `world/prepare_download` builds the zip into `<cwd>/.nexcraft_world_dl/<fileName>` (wiping that dir first) and returns the relative path; the panel then registers a `download` passport and the existing `/download/:key/:fileName` HTTP route serves it (it resolves relative to cwd and is single-use).

```typescript
import fs from "fs-extra";
import path from "path";
import { $t } from "../i18n";
import * as protocol from "../service/protocol";
import { routerApp } from "../service/router";
import FileManager from "../service/system_file";
import InstanceSubsystem from "../service/system_instance";
import { TaskCenter } from "../service/async_task_service";
import { WorldReplaceTask } from "../service/async_task_service/world_replace_task";
import { WorldResetTask } from "../service/async_task_service/world_reset_task";
import { readLevelName } from "../service/modpack_files";
import {
  WORLD_DOWNLOAD_DIR,
  getWorldInfo,
  getWorldKind,
  worldDownloadFileName,
  zipWorld
} from "../service/world_service";

// Read-only info about the active world.
routerApp.on("world/info", async (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    protocol.response(ctx, await getWorldInfo(inst));
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Build a downloadable world archive into a temp dir under cwd. Returns the
// relative path (served by the shared /download/:key/:fileName route) plus the
// browser-suggested filename. Read-only: no stop, no backup.
routerApp.on("world/prepare_download", async (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const cwd = inst.absoluteCwdPath();
    const kind = getWorldKind(inst);
    const levelName = readLevelName(cwd);
    const fileName = worldDownloadFileName(kind, levelName);
    const dlDir = path.join(cwd, WORLD_DOWNLOAD_DIR);
    await fs.remove(dlDir);
    await fs.ensureDir(dlDir);
    await zipWorld(cwd, kind, levelName, path.join(dlDir, fileName));
    protocol.response(ctx, {
      fileName,
      relPath: path.posix.join(WORLD_DOWNLOAD_DIR, fileName)
    });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Replace the active world from an already-uploaded archive in WORLD_UPLOAD_DIR.
routerApp.on("world/replace", (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const hint = String(data.fileName || "");
    if (hint && !FileManager.checkFileName(path.basename(hint)))
      throw new Error("Access denied: Malformed file name");
    const task = new WorldReplaceTask(inst, hint);
    TaskCenter.addTask(task);
    protocol.response(ctx, { taskId: task.taskId });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Reset the active world (delete -> regenerate on next start).
routerApp.on("world/reset", (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const task = new WorldResetTask(inst);
    TaskCenter.addTask(task);
    protocol.response(ctx, { taskId: task.taskId });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Poll a world task.
routerApp.on("world/task_status", (ctx, data) => {
  try {
    const task = TaskCenter.getTask(data.taskId);
    protocol.response(ctx, task ? task.toObject() : null);
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});
```

- [ ] **Step 2: Register the router in `daemon/src/service/router.ts`**

Add the import alongside the other `import "../routers/..."` lines (keep alphabetical-ish; place after the `player_router` / `schedule_router` group is fine). Exact new line:

```typescript
import "../routers/world_router";
```

- [ ] **Step 3: Type-check the daemon**

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
```
Expected: no TypeScript errors. (Confirm `FileManager.checkFileName` is a static method — it is, per `http_router.ts` usage `FileManager.checkFileName(...)`.)

- [ ] **Step 4: Commit**

```powershell
git add daemon/src/routers/world_router.ts daemon/src/service/router.ts
git commit -m @'
feat(world): daemon world_router (info/prepare_download/replace/reset/task_status)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 5: Panel `world_router.ts` + op-log types + mount

**Files:**
- Modify: `panel/src/types/operation_logger.ts`
- Create: `panel/src/app/routers/world_router.ts`
- Modify: `panel/src/app/index.ts`

- [ ] **Step 1: Add op-log action types**

Open `panel/src/types/operation_logger.ts`. Find the `InstanceBackupRestore = "instance_backup_restore"` enum entry and the corresponding payload `type` (e.g. `InstanceBackupRestoreOptions`) and its inclusion in the payload-map union. Mirror that pattern EXACTLY for two new actions. Concretely:

1. In the `OperationLoggerAction` enum (or equivalent string enum), add:
```typescript
  InstanceWorldReplace = "instance_world_replace",
  InstanceWorldReset = "instance_world_reset",
```
2. Add payload types mirroring the backup-restore one (which carries `daemon_id` + `instance_id`):
```typescript
export type InstanceWorldReplaceOptions = {
  type: "instance_world_replace";
  daemon_id: string;
  instance_id: string;
} & GlobalGeneralOptions;

export type InstanceWorldResetOptions = {
  type: "instance_world_reset";
  daemon_id: string;
  instance_id: string;
} & GlobalGeneralOptions;
```
3. Add both to the payload-map / union that `operationLogger.log()` is typed against (find where `instance_backup_restore` is wired into that map and add `instance_world_replace` / `instance_world_reset` the same way). If the file keys payloads by the string literal, add:
```typescript
  instance_world_replace: InstanceWorldReplaceOptions;
  instance_world_reset: InstanceWorldResetOptions;
```

(Read the file first and match its exact shape — do not invent a different structure.)

- [ ] **Step 2: Create `panel/src/app/routers/world_router.ts`**

```typescript
import Router from "@koa/router";
import { ROLE } from "../entity/user";
import { $t } from "../i18n";
import { speedLimit } from "../middleware/limit";
import permission from "../middleware/permission";
import validator from "../middleware/validator";
import { operationLogger } from "../service/operation_logger";
import { getUserUuid } from "../service/passport_service";
import { timeUuid } from "../service/password";
import { isHaveInstanceByUuid } from "../service/permission_service";
import RemoteRequest from "../service/remote_command";
import RemoteServiceSubsystem from "../service/remote_service";

const router = new Router({ prefix: "/protected_world" });

// Must own the target instance (same guard as backup_router).
router.use(async (ctx, next) => {
  const instanceUuid = String(ctx.query.uuid);
  const daemonId = String(ctx.query.daemonId);
  const userUuid = getUserUuid(ctx);
  if (isHaveInstanceByUuid(userUuid, daemonId, instanceUuid)) {
    await next();
  } else {
    ctx.status = 403;
    ctx.body = $t("TXT_CODE_permission.forbiddenInstance");
  }
});

// Active world info (admin).
router.get(
  "/info",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "world/info",
        { instanceUuid }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Prepare a world download: build the archive on the daemon, then register a
// one-time download passport. Returns { password, addr, remoteMappings, fileName }
// so the frontend can hit the shared /download/:key/:fileName route.
router.post(
  "/download",
  permission({ level: ROLE.ADMIN }),
  speedLimit(3),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const remoteService = RemoteServiceSubsystem.getInstance(daemonId);
      if (!remoteService) throw new Error($t("TXT_CODE_dd559000") + ` Daemon ID: ${daemonId}`);
      const prepared = await new RemoteRequest(remoteService).request("world/prepare_download", {
        instanceUuid
      });
      const addr = remoteService.config.fullAddr;
      const remoteMappings = remoteService.config.getConvertedRemoteMappings();
      const password = timeUuid();
      await new RemoteRequest(remoteService).request("passport/register", {
        name: "download",
        password,
        parameter: { fileName: prepared.relPath, instanceUuid }
      });
      ctx.body = { password, addr, remoteMappings, fileName: prepared.fileName };
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Replace the active world from an uploaded archive (admin).
router.post(
  "/replace",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String, uuid: String }, body: { fileName: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const fileName = String(ctx.request.body.fileName);
      operationLogger.log("instance_world_replace", {
        operator_ip: ctx.ip,
        operator_name: ctx.session?.["userName"],
        instance_id: instanceUuid,
        daemon_id: daemonId
      });
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "world/replace",
        { instanceUuid, fileName }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Reset the active world (admin).
router.post(
  "/reset",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      operationLogger.log("instance_world_reset", {
        operator_ip: ctx.ip,
        operator_name: ctx.session?.["userName"],
        instance_id: instanceUuid,
        daemon_id: daemonId
      });
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "world/reset",
        { instanceUuid }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Poll a world task (admin).
router.get(
  "/task_status",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String, uuid: String, task_id: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const taskId = String(ctx.query.task_id);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "world/task_status",
        { taskId }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

export default router;
```

- [ ] **Step 3: Mount the router in `panel/src/app/index.ts`**

Add the import near the other `import ... from "./routers/..."` lines:
```typescript
import worldRouter from "./routers/world_router";
```
And inside `mountRouters(...)`, alongside the other `apiRouter.use(...)` lines (e.g. right after the backup/import router mounts):
```typescript
  apiRouter.use(worldRouter.routes()).use(worldRouter.allowedMethods());
```

- [ ] **Step 4: Type-check the panel (this also compiles the daemon)**

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix panel
```
Expected: no TypeScript errors. (If `prepared` is typed `unknown`, annotate the `request<...>` call: `request<{ fileName: string; relPath: string }>("world/prepare_download", { instanceUuid })`.)

- [ ] **Step 5: Commit**

```powershell
git add panel/src/types/operation_logger.ts panel/src/app/routers/world_router.ts panel/src/app/index.ts
git commit -m @'
feat(world): panel /protected_world proxy + world op-log actions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 6: Frontend API module `world.ts`

**Files:**
- Create: `frontend/src/services/apis/world.ts`

- [ ] **Step 1: Create the file**

```typescript
import { useDefineApi } from "@/stores/useDefineApi";

export interface WorldInfo {
  levelName: string;
  kind: "java" | "bedrock";
  exists: boolean;
  size: number;
  lastModified: number;
}

export const worldInfo = useDefineApi<{ params: { uuid: string; daemonId: string } }, WorldInfo>({
  url: "/api/protected_world/info",
  method: "GET"
});

// Returns the daemon address + one-time token to fetch the world via /download/:key/:fileName.
export const worldDownloadAddress = useDefineApi<
  { params: { uuid: string; daemonId: string } },
  {
    password: string;
    addr: string;
    remoteMappings: any[];
    fileName: string;
  }
>({
  url: "/api/protected_world/download",
  method: "POST"
});

export const worldReplace = useDefineApi<
  { params: { uuid: string; daemonId: string }; data: { fileName: string } },
  { taskId: string }
>({
  url: "/api/protected_world/replace",
  method: "POST"
});

export const worldReset = useDefineApi<
  { params: { uuid: string; daemonId: string } },
  { taskId: string }
>({
  url: "/api/protected_world/reset",
  method: "POST"
});

export const worldTaskStatus = useDefineApi<
  { params: { uuid: string; daemonId: string; task_id: string } },
  {
    taskId: string;
    status: number; // 1 running, 0 done/stopped, -1 error
    instanceStatus?: number;
    phase?: string;
  } | null
>({
  url: "/api/protected_world/task_status",
  method: "GET"
});
```

- [ ] **Step 2: Type-check the frontend**

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run type-check --prefix frontend
```
Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/services/apis/world.ts
git commit -m @'
feat(world): frontend world API module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 7: Frontend `World.vue` card

**Files:**
- Create: `frontend/src/widgets/instance/World.vue`

Modeled on `frontend/src/widgets/instance/ModpackUpdate.vue` (read it first for the exact CardPanel/BetweenMenus/return-button/poll idioms). Upload reuses `uploadAddress()` + `uploadService.append(...)` (the blessed transport); download mirrors `useFileManager`'s `getFileLink` (`parseForwardAddress(getFileConfigAddr(cfg), "http")` + `/download/{password}/{fileName}`).

- [ ] **Step 1: Confirm the address-helper import paths**

Open `frontend/src/hooks/useFileManager.ts` and note the exact import lines for `parseForwardAddress` and `getFileConfigAddr` (used in its `getFileLink`). Copy those same import statements into `World.vue` in the next step. (They are shared helpers; do not re-implement them.)

- [ ] **Step 2: Create `World.vue`**

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch } from "vue";
import { Modal } from "ant-design-vue";
import {
  CloudDownloadOutlined,
  UploadOutlined,
  DeleteOutlined,
  RollbackOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined
} from "@ant-design/icons-vue";
import { createVNode } from "vue";
import CardPanel from "@/components/CardPanel.vue";
import BetweenMenus from "@/components/BetweenMenus.vue";
import { t } from "@/lang/i18n";
import { useScreen } from "@/hooks/useScreen";
import { useLayoutCardTools } from "@/hooks/useCardTools";
import { useAppRouters } from "@/hooks/useAppRouters";
import { reportErrorMsg } from "@/tools/validator";
import { message } from "ant-design-vue";
import uploadService from "@/services/uploadService";
// NOTE: copy these two import lines verbatim from hooks/useFileManager.ts (Step 1):
import { parseForwardAddress } from "@/tools/protocol";
import { getFileConfigAddr } from "@/tools/protocol";
import { uploadAddress } from "@/services/apis/fileManager";
import {
  worldInfo,
  worldDownloadAddress,
  worldReplace,
  worldReset,
  worldTaskStatus,
  type WorldInfo
} from "@/services/apis/world";
import { WORLD_UPLOAD_DIR } from "@/services/apis/world"; // (only if you export the const; otherwise inline the string)

const props = defineProps<{
  card: any;
}>();

const { isPhone } = useScreen();
const { toPage } = useAppRouters();
const { getMetaOrRouteValue } = useLayoutCardTools(props.card);
const instanceId = String(getMetaOrRouteValue("instanceId") ?? "");
const daemonId = String(getMetaOrRouteValue("daemonId") ?? "");

const UPLOAD_DIR = ".nexcraft_world_up";

const info = ref<WorldInfo | null>(null);
const loading = ref(false);
const taskRunning = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

const formatBytes = (n: number) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};
const formatTime = (ms: number) => (ms ? new Date(ms).toLocaleString() : "-");

const downloadHint = computed(() =>
  info.value?.kind === "bedrock"
    ? t("TXT_CODE_world_download_hint_bedrock")
    : t("TXT_CODE_world_download_hint_java")
);

const loadInfo = async () => {
  loading.value = true;
  try {
    const { execute } = worldInfo();
    const res = await execute({ params: { uuid: instanceId, daemonId }, forceRequest: true });
    info.value = res.value;
  } catch (e: any) {
    reportErrorMsg(e?.message || String(e));
  } finally {
    loading.value = false;
  }
};

const stopPolling = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
};

const pollTask = (taskId: string, doneMsg: string) => {
  taskRunning.value = true;
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const { execute } = worldTaskStatus();
      const res = await execute({
        params: { uuid: instanceId, daemonId, task_id: taskId },
        forceRequest: true
      });
      const task = res.value;
      // task becomes null once cleared, or status !== 1 when finished
      if (!task || task.status !== 1) {
        stopPolling();
        taskRunning.value = false;
        if (task && task.status === -1) {
          reportErrorMsg(t("TXT_CODE_world_task_failed"));
        } else {
          message.success(doneMsg);
        }
        await loadInfo();
      }
    } catch {
      // transient daemon hiccup during restart — keep polling
    }
  }, 1500);
};

const onDownload = async () => {
  try {
    const { execute } = worldDownloadAddress();
    const res = await execute({ params: { uuid: instanceId, daemonId } });
    if (!res.value) return;
    const addr = parseForwardAddress(getFileConfigAddr(res.value), "http");
    const link = `${addr}/download/${res.value.password}/${encodeURIComponent(res.value.fileName)}`;
    window.open(link);
  } catch (e: any) {
    reportErrorMsg(e?.message || String(e));
  }
};

// Observe uploadService completion (same idiom as useModUpload.ts).
let wasUploading = false;
let pendingReplaceFileName = "";
watch(
  () => uploadService.uiData.value,
  (v) => {
    if (v.current) {
      wasUploading = true;
    } else if (wasUploading) {
      wasUploading = false;
      uploading.value = false;
      if (pendingReplaceFileName) {
        const name = pendingReplaceFileName;
        pendingReplaceFileName = "";
        confirmAndReplace(name);
      }
    }
  },
  { immediate: true }
);

const confirmAndReplace = (fileName: string) => {
  Modal.confirm({
    title: t("TXT_CODE_world_replace_confirm_title"),
    icon: createVNode(ExclamationCircleOutlined),
    content: t("TXT_CODE_world_replace_confirm"),
    async onOk() {
      try {
        const { execute } = worldReplace();
        const res = await execute({
          params: { uuid: instanceId, daemonId },
          data: { fileName }
        });
        if (res.value?.taskId) pollTask(res.value.taskId, t("TXT_CODE_world_task_replace_done"));
      } catch (e: any) {
        reportErrorMsg(e?.message || String(e));
      }
    }
  });
};

const onPickFile = () => fileInput.value?.click();

const onFileChange = async (e: Event) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;
  const file = Array.from(files).find((f) => f.size > 0);
  if (fileInput.value) fileInput.value.value = "";
  if (!file) return;
  try {
    uploading.value = true;
    const { state: cfg, execute: getCfg } = uploadAddress();
    await getCfg({ params: { upload_dir: UPLOAD_DIR, daemonId, uuid: instanceId } });
    if (!cfg.value?.password) throw new Error("upload init failed");
    const addr = parseForwardAddress(getFileConfigAddr(cfg.value), "http");
    pendingReplaceFileName = file.name;
    uploadService.append(file, addr, cfg.value.password, { overwrite: true }, (task) => {
      task.instanceInfo = { instanceId, daemonId };
    });
  } catch (e: any) {
    uploading.value = false;
    pendingReplaceFileName = "";
    reportErrorMsg(e?.message || String(e));
  }
};

const onReset = () => {
  Modal.confirm({
    title: t("TXT_CODE_world_reset_confirm_title"),
    icon: createVNode(ExclamationCircleOutlined),
    content: t("TXT_CODE_world_reset_confirm"),
    async onOk() {
      try {
        const { execute } = worldReset();
        const res = await execute({ params: { uuid: instanceId, daemonId } });
        if (res.value?.taskId) pollTask(res.value.taskId, t("TXT_CODE_world_task_reset_done"));
      } catch (e: any) {
        reportErrorMsg(e?.message || String(e));
      }
    }
  });
};

const toConsole = () => {
  toPage({ path: `/instances/terminal`, query: { daemonId, instanceId } });
};

onMounted(loadInfo);
onBeforeUnmount(stopPolling);
</script>

<template>
  <div style="height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="height: 100%">
      <a-col :span="24">
        <BetweenMenus>
          <template v-if="!isPhone" #left>
            <a-typography-title :level="4" style="margin: 0">
              <RollbackOutlined />
              {{ t("TXT_CODE_world_card_title") }}
            </a-typography-title>
          </template>
          <template #right>
            <a-button class="mr-8" :loading="loading" @click="loadInfo">
              <ReloadOutlined /> {{ t("TXT_CODE_world_current") }}
            </a-button>
            <a-button type="default" @click="toConsole">
              <RollbackOutlined /> {{ t("TXT_CODE_backup_to_console") }}
            </a-button>
          </template>
        </BetweenMenus>
      </a-col>

      <a-col :span="24">
        <CardPanel style="height: 100%">
          <template #title>{{ t("TXT_CODE_world_current") }}</template>
          <template #body>
            <a-descriptions v-if="info && info.exists" :column="1" bordered size="small">
              <a-descriptions-item :label="t('TXT_CODE_world_name')">{{ info.levelName }}</a-descriptions-item>
              <a-descriptions-item :label="t('TXT_CODE_world_type')">{{ info.kind === "bedrock" ? "Bedrock" : "Java" }}</a-descriptions-item>
              <a-descriptions-item :label="t('TXT_CODE_world_size')">{{ formatBytes(info.size) }}</a-descriptions-item>
              <a-descriptions-item :label="t('TXT_CODE_world_modified')">{{ formatTime(info.lastModified) }}</a-descriptions-item>
            </a-descriptions>
            <a-empty v-else :description="t('TXT_CODE_world_none')" />

            <a-spin v-if="taskRunning" :tip="t('TXT_CODE_world_task_running')" style="margin-top: 16px" />
            <a-spin v-else-if="uploading" :tip="t('TXT_CODE_world_uploading')" style="margin-top: 16px" />

            <div style="margin-top: 24px; display: flex; flex-wrap: wrap; gap: 12px">
              <a-button :disabled="taskRunning || uploading || !info?.exists" @click="onDownload">
                <CloudDownloadOutlined /> {{ t("TXT_CODE_world_download") }}
              </a-button>
              <a-button :disabled="taskRunning || uploading" @click="onPickFile">
                <UploadOutlined /> {{ t("TXT_CODE_world_replace") }}
              </a-button>
              <a-button danger :disabled="taskRunning || uploading || !info?.exists" @click="onReset">
                <DeleteOutlined /> {{ t("TXT_CODE_world_reset") }}
              </a-button>
              <input ref="fileInput" type="file" accept=".zip,.mcworld" style="display: none" @change="onFileChange" />
            </div>

            <a-typography-paragraph type="secondary" style="margin-top: 12px">
              {{ downloadHint }}<br />
              {{ t("TXT_CODE_world_replace_hint") }}<br />
              {{ t("TXT_CODE_world_reset_hint") }}
            </a-typography-paragraph>
          </template>
        </CardPanel>
      </a-col>
    </a-row>
  </div>
</template>
```

> **Implementation notes for the engineer (verify against the real codebase as you go):**
> - `useScreen`, `useCardTools` (`useLayoutCardTools`), `useAppRouters`, `CardPanel`, `BetweenMenus`, `reportErrorMsg` — confirm exact import paths against `ModpackUpdate.vue`; adjust if they differ.
> - `uploadService.uiData` shape and `UploadTask.instanceInfo` — confirm against `useModUpload.ts` / `uploadService.ts`; if `uiData.value.current` is named differently, match it.
> - `parseForwardAddress` / `getFileConfigAddr` import paths come from Step 1 (do NOT trust the placeholder `@/tools/protocol` above — replace with the real paths).
> - `WORLD_UPLOAD_DIR` is a daemon constant; the frontend just uses the literal `".nexcraft_world_up"` (defined as `UPLOAD_DIR` above). Remove the stray `import { WORLD_UPLOAD_DIR }` line — it is not exported to the frontend.
> - `t("TXT_CODE_backup_to_console")` is the existing "Return to console" key used by other cards; reuse it (no new key needed).

- [ ] **Step 3: Type-check the frontend**

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run type-check --prefix frontend
```
Expected: no errors. Fix import paths / prop typing until clean.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/widgets/instance/World.vue
git commit -m @'
feat(world): World.vue card (info / download / replace / reset)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 8: Register the card (4 places) + nav button

**Files:**
- Modify: `frontend/src/config/index.ts`
- Modify: `frontend/src/config/router.ts`
- Modify: `panel/src/app/service/frontend_layout.ts`
- Modify: `frontend/src/widgets/instance/ManagerBtns.vue`

Follow the `InstanceModpackUpdate` precedent exactly in each file (read the surrounding entries first).

- [ ] **Step 1: Register the component + card pool entry in `frontend/src/config/index.ts`**

1. Import (next to `import InstanceModpackUpdate from "@/widgets/instance/ModpackUpdate.vue";`):
```typescript
import InstanceWorld from "@/widgets/instance/World.vue";
```
2. Add to the `LAYOUT_CARD_TYPES` map (next to `InstanceModpackUpdate,`):
```typescript
  InstanceWorld,
```
3. Add a card-pool entry mirroring the `InstanceModpackUpdate` block (admin-gated, same `params`):
```typescript
    {
      id: getRandomId(),
      permission: ROLE.ADMIN,
      meta: {},
      type: "InstanceWorld",
      title: t("TXT_CODE_world_card_title"),
      width: 12,
      description: t("TXT_CODE_world_card_desc"),
      height: LayoutCardHeight.MEDIUM,
      category: NEW_CARD_TYPE.INSTANCE,
      params: [
        { field: "instanceId", label: t("TXT_CODE_e6a5c12b"), type: "string" },
        { field: "daemonId", label: t("TXT_CODE_72cfab69"), type: "string" },
        { field: "instance", label: t("TXT_CODE_cb043d10"), type: "instance" }
      ]
    },
```

- [ ] **Step 2: Register the route in `frontend/src/config/router.ts`**

Add next to the `/instances/modpackUpdate` entry:
```typescript
        {
          path: `/instances/world`,
          name: t("TXT_CODE_world_card_title"),
          component: LayoutContainer,
          meta: {
            permission: ROLE.USER
          }
        },
```
(The route guard is `ROLE.USER`; the card and the backend endpoints enforce `ROLE.ADMIN`.)

- [ ] **Step 3: Register the default page in `panel/src/app/service/frontend_layout.ts`**

Add a page entry mirroring `/instances/modpackUpdate`:
```typescript
    {
      page: "/instances/world",
      items: [
        {
          id: getRandomId(),
          meta: {},
          type: "InstanceWorld",
          title: t("TXT_CODE_world_card_title"),
          width: 12,
          height: LayoutCardHeight.AUTO,
          disableDelete: true
        },
        {
          id: getRandomId(),
          meta: {},
          type: "EmptyCard",
          title: "",
          width: 12,
          height: LayoutCardHeight.MINI
        }
      ]
    },
```
(Per CLAUDE.md, `frontend_layout.ts` auto-merges missing default pages into a saved layout, so existing users get the page.)

- [ ] **Step 4: Add the nav button in `frontend/src/widgets/instance/ManagerBtns.vue`**

1. Add `InstanceWorld` to the widget imports (next to `InstanceModpackUpdate`):
```typescript
import InstanceWorld from "@/widgets/instance/World.vue";
```
2. Confirm `GlobalOutlined` (or a suitable globe/world icon) is imported from `@ant-design/icons-vue`; add it if missing.
3. Add a button entry in the `btns` computed array (admin-gated; show for any Minecraft instance):
```typescript
    {
      title: t("TXT_CODE_world_card_title"),
      icon: GlobalOutlined,
      condition: () => isAdmin.value && !isGlobalTerminal.value,
      click: () => {
        openManage(InstanceWorld, t("TXT_CODE_world_card_title"));
      }
    },
```
(Match the exact `condition`/`openManage` idiom used by the neighbouring buttons — read the surrounding entries; if buttons gate on instance type, mirror that.)

- [ ] **Step 5: Type-check frontend + panel**

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run type-check --prefix frontend
npm run build --prefix panel
```
Expected: both clean.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/config/index.ts frontend/src/config/router.ts panel/src/app/service/frontend_layout.ts frontend/src/widgets/instance/ManagerBtns.vue
git commit -m @'
feat(world): register World card (config/router/layout) + ManagerBtns nav button

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 9: Full build verification + manual test checklist + push

**Files:** none (verification only)

- [ ] **Step 1: Full local builds (the binding gate)**

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
npm run build --prefix panel
npm run build --prefix frontend
```
Expected: all three complete with no errors. (The web build compiles the daemon too — a daemon type error breaks the web build.)

- [ ] **Step 2: Push the branch**

```powershell
git push -u origin feat/world-management
```

- [ ] **Step 3: Provide the FULL Unraid rebuild block to the user**

Both images change (daemon: `daemon/`,`common/`; web: `frontend/`,`panel/`,`languages/`). Paste the COMPLETE copy-paste rebuild block per CLAUDE.md — `cd` + `git pull` + BOTH `docker build` + BOTH `docker rm -f` + BOTH `docker run` (daemon incl. the `/mnt/user/Backup/Minecraft` backup mount) + `docker ps | grep nexcraft`. Do NOT abbreviate. (Use the Test stack: `:test` tag, web `192.168.2.47`, daemon `192.168.2.46`.)

- [ ] **Step 4: Manual verification on the Test stack (from the spec)**

Walk through and record results:
  1. **Java download:** open the World card on a Java instance → Download → the `.zip` contains `<level-name>` (+ `_nether`/`_the_end` if present).
  2. **Java replace:** upload a world zip in each variant — (a) root `level.dat`, (b) nested `world/level.dat`, (c) `world_x/level.dat` — → world swapped; a `world-*.zip` appears in the **Backups** card; server starts on the new world.
  3. **Java reset:** Reset → fresh world generated on restart; a `world-*.zip` backup was taken.
  4. **Bedrock download:** `.mcworld` downloads and opens in the Bedrock client.
  5. **Bedrock replace:** replace from a `.mcworld` → world swapped under `worlds/<level-name>`.
  6. **Permissions:** a non-admin user cannot see the card / cannot call replace/reset (403). Download token is single-use (a second GET on the same URL fails).
  7. **Restore path:** restore the auto `world-*.zip` from the **Backups** card → recovers the pre-replace world.
  8. **No-world edge:** on a brand-new instance that never started, the card shows the empty state; Download/Reset are disabled; Replace still works (no backup taken since there is no world).

- [ ] **Step 5: After the user confirms the manual tests, use `superpowers:finishing-a-development-branch`** to decide merge/PR/cleanup.

---

## Self-Review (run by the plan author)

**Spec coverage:**
- Current world panel (name/type/size/last-modified) → Task 2 `getWorldInfo` + Task 7 descriptions. ✓
- Download (Java `.zip` of world+nether+end; Bedrock `.mcworld` contents-at-root; no stop/backup) → Task 2 `zipWorld`, Task 4 `world/prepare_download`, Task 5 panel `/download` reusing passport + `/download/:key/:fileName`, Task 7 `onDownload`. ✓
- Replace/Restore (chunked upload → stop → world-backup → wipe → extract → `findWorldRoot` → place → restart) → Task 3 `WorldReplaceTask`, Task 7 upload via `uploadAddress`+`uploadService`. ✓
- Reset (stop → world-backup → remove → restart/regen) → Task 3 `WorldResetTask`. ✓
- Auto world-only backup on replace & reset only (restore-compatible, into Backups area) → Task 2 `backupActiveWorld` (relative paths preserved, `world-<ts>.zip`). ✓
- Confirms on replace & reset; none on download → Task 7 `Modal.confirm`. ✓
- Admin-gated → card `permission: ROLE.ADMIN` (Task 8), all panel routes `permission({ level: ROLE.ADMIN })` (Task 5), nav button `isAdmin` (Task 8). ✓
- Java 3-folder world set + modded DIM nesting → `getActiveWorldPaths` + `placeWorld` siblings (Task 2). ✓
- Reject archive with no `level.dat` → `findWorldRoot` undefined → `TXT_CODE_world.noLevelDat` (Tasks 2/3). ✓
- Backend surface (daemon `world_service` + 2 tasks + router actions; panel proxy + op-log; frontend api + card + 4 registrations + nav) → Tasks 2-8. ✓
- i18n in en_US.json → Task 1. ✓

**Deviations from spec (documented):**
- Spec names a single `world/download` returning `{token, fileName}`; implemented as daemon `world/prepare_download` (builds the zip) + panel registering the `download` passport (matches the existing file/backup-download idiom exactly) and returning `{password, addr, remoteMappings, fileName}`. Net behavior identical; reuses the existing `/download/:key/:fileName` route verbatim.
- Spec's `getActiveWorldPaths`/`findWorldRoot`/`zipWorld`/`backupActiveWorld`/`wipeActiveWorld`/`placeWorld` signatures are all present (Task 2), with an added `getWorldInfo`/`getWorldKind`/`worldDownloadFileName` for the info panel and download naming.
- Spec mentions `mc_motd.ts`'s parser; we use the already-exported `readLevelName` from `modpack_files.ts` (same parser, public).

**Placeholder scan:** Address-helper imports in Task 7 are explicitly flagged as "replace with real paths from Step 1" (the engineer copies them from `useFileManager.ts`); op-log payload shape in Task 5 is "mirror `instance_backup_restore`" with the exact lines given. These are the only two "match the existing file" steps and both name the precise precedent. No TBD/TODO left.

**Type consistency:** `worldDownloadAddress` returns `{password, addr, remoteMappings, fileName}` (panel `/download` body) — matches Task 6 api + Task 7 usage. `worldReplace` body `{fileName}` matches panel validator + daemon `world/replace data.fileName` + `WorldReplaceTask.hintFileName`. Task constants `WORLD_UPLOAD_DIR`/`WORLD_DOWNLOAD_DIR`/`WORLD_EXTRACT_DIR` defined once in `world_service.ts` and imported by tasks/router. Task status shape `{taskId,status,instanceStatus,phase}` consistent across `toObject()` and `worldTaskStatus`. ✓
