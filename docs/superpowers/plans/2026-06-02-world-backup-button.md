# "Back up world" button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Back up world** button to the World Management card that creates a restorable world-only backup (`world-<ts>.zip`) in the instance's Backups area, running as a tracked async task without stopping the server.

**Architecture:** Mirror the existing `world/reset` path end-to-end. A new daemon `WorldBackupTask` calls the existing `backupActiveWorld()` (hot — no stop, no status change). A `world/backup` daemon event + panel `/protected_world/backup` route + a `worldBackup` frontend API + a button in `World.vue` that reuses the existing `pollTask`/`worldTaskStatus` progress flow.

**Tech Stack:** TypeScript (daemon async tasks + socket-RPC routers, Koa panel routers), Vue 3 + Ant Design Vue + vue-i18n.

**Spec:** `docs/superpowers/specs/2026-06-02-world-backup-button-design.md`

---

## Testing & verification note (READ FIRST)

No unit-test runner exists (builds-not-tests). Each task is verified by a clean build/type-check; the feature is validated by a manual Test-stack pass (final task). PowerShell prefix (stale PATH each shell):

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
```

- Daemon build: `npm run build --prefix daemon`
- Panel build (also compiles daemon): `npm run build --prefix panel`
- Frontend type-check: `npm run type-check --prefix frontend`

All work lands on **`test`**. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Do not push from subagents (the controller pushes).

---

## File Structure

- **Create** `daemon/src/service/async_task_service/world_backup_task.ts` — `WorldBackupTask` (hot world-only backup).
- **Modify** `daemon/src/routers/world_router.ts` — add the `world/backup` event.
- **Modify** `panel/src/app/routers/world_router.ts` — add `POST /backup` (no operation-log; see note).
- **Modify** `frontend/src/services/apis/world.ts` — add `worldBackup`.
- **Modify** `languages/en_US.json` — 3 new i18n keys.
- **Modify** `frontend/src/widgets/instance/World.vue` — add the button + handler + hint.

> **Note:** the panel route intentionally does NOT call `operationLogger.log(...)` (reset/replace do, but those mutate the world). `operationLogger.log`'s first arg is typed against the closed `OperationLoggerItemPayload` union, so adding an audit entry would require editing `panel/src/types/operation_logger.ts`; we skip it for this non-destructive action. The daemon still prints "Backing up world…/Done" to the instance console.

---

## Task 1: Daemon `WorldBackupTask`

**Files:**
- Create: `daemon/src/service/async_task_service/world_backup_task.ts`

- [ ] **Step 1: Create the task file**

Create `daemon/src/service/async_task_service/world_backup_task.ts` with exactly:

```typescript
import { v4 } from "uuid";
import Instance from "../../entity/instance/instance";
import { $t } from "../../i18n";
import { readLevelName } from "../modpack_files";
import { backupActiveWorld, getActiveWorldPaths, getWorldKind } from "../world_service";
import logger from "../log";
import { AsyncTask, IAsyncTaskJSON } from "./index";

// Hot world-only backup: zip the active world into the Backups area
// (world-<ts>.zip, restorable from the Backups card) WITHOUT stopping the
// server or changing instance status.
export class WorldBackupTask extends AsyncTask {
  public static TYPE = "WorldBackupTask";
  public phase: "backup" | "done" = "backup";

  constructor(public instance: Instance) {
    super();
    this.taskId = `${WorldBackupTask.TYPE}-${instance.instanceUuid}-${v4()}`;
    this.type = WorldBackupTask.TYPE;
  }

  async onStart() {
    const inst = this.instance;
    const status = inst.status();
    if (status === Instance.STATUS_BUSY || status === Instance.STATUS_STARTING) {
      this.error(new Error($t("TXT_CODE_backup.busy")));
      return;
    }
    const cwd = inst.absoluteCwdPath();
    const kind = getWorldKind(inst);
    const levelName = readLevelName(cwd);
    if (getActiveWorldPaths(cwd, kind, levelName).length === 0) {
      this.error(new Error($t("TXT_CODE_world.noWorld")));
      return;
    }
    try {
      this.phase = "backup";
      inst.println("INFO", $t("TXT_CODE_world.backup"));
      await backupActiveWorld(inst);
      this.phase = "done";
      inst.println("INFO", $t("TXT_CODE_world.done"));
    } catch (error: any) {
      this.error(error);
      return;
    }
    this.stop();
  }

  async onStop() {}

  async onError(err: Error) {
    logger.error(`WorldBackupTask error: ${err?.message}`);
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

> All imports/symbols (`AsyncTask`, `IAsyncTaskJSON`, `this.error/stop/status`, `backupActiveWorld`, `getActiveWorldPaths`, `getWorldKind`, `readLevelName`, `logger`, and the `$t` keys) are exactly those used by the sibling `world_reset_task.ts`.

- [ ] **Step 2: Verify the daemon builds**

Run: `npm run build --prefix daemon`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```powershell
git add daemon/src/service/async_task_service/world_backup_task.ts
git commit -m "feat(daemon): WorldBackupTask (hot world-only restorable backup)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Daemon `world/backup` event

**Files:**
- Modify: `daemon/src/routers/world_router.ts`

- [ ] **Step 1: Add the import**

In `daemon/src/routers/world_router.ts`, add next to the existing `WorldResetTask` import:

```typescript
import { WorldBackupTask } from "../service/async_task_service/world_backup_task";
```

- [ ] **Step 2: Add the event**

Insert this handler immediately AFTER the existing `routerApp.on("world/reset", ...)` block and BEFORE `routerApp.on("world/task_status", ...)`:

```typescript
// Back up the active world (hot; world-only restorable backup into Backups).
routerApp.on("world/backup", (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const task = new WorldBackupTask(inst);
    TaskCenter.addTask(task);
    protocol.response(ctx, { taskId: task.taskId });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});
```

- [ ] **Step 3: Verify the daemon builds**

Run: `npm run build --prefix daemon`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```powershell
git add daemon/src/routers/world_router.ts
git commit -m "feat(daemon): world/backup router event" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Panel `/backup` route

**Files:**
- Modify: `panel/src/app/routers/world_router.ts`

- [ ] **Step 1: Add the route**

In `panel/src/app/routers/world_router.ts`, insert this route immediately AFTER the existing `router.post("/reset", ...)` block and BEFORE the `// Poll a world task` route:

```typescript
// Back up the active world (admin) — non-destructive, no operation log.
router.post(
  "/backup",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "world/backup",
        { instanceUuid }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);
```

> `permission`, `validator`, `ROLE`, `RemoteRequest`, `RemoteServiceSubsystem` are already imported. Do NOT add an `operationLogger.log` call (see the File Structure note).

- [ ] **Step 2: Verify the panel builds**

Run: `npm run build --prefix panel`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```powershell
git add panel/src/app/routers/world_router.ts
git commit -m "feat(panel): /protected_world/backup proxy route" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend API + i18n keys

**Files:**
- Modify: `frontend/src/services/apis/world.ts`
- Modify: `languages/en_US.json`

- [ ] **Step 1: Add the API**

Append to `frontend/src/services/apis/world.ts` (after the `worldReset` export, before `worldTaskStatus` is fine too — anywhere among the exports):

```typescript
export const worldBackup = useDefineApi<
  { params: { uuid: string; daemonId: string } },
  { taskId: string }
>({
  url: "/api/protected_world/backup",
  method: "POST"
});
```

- [ ] **Step 2: Add the i18n keys**

In `languages/en_US.json`, add these keys near the existing `TXT_CODE_world_*` keys (search for `TXT_CODE_world_reset_hint`). Keep the JSON valid (commas):

```json
"TXT_CODE_world_backup_btn": "Back up world",
"TXT_CODE_world_backup_hint": "Save the current world to this instance's backups (restorable from the Backups card). The server keeps running.",
"TXT_CODE_world_task_backup_done": "World backed up"
```

- [ ] **Step 3: Verify the frontend type-checks**

Run: `npm run type-check --prefix frontend`
Expected: no errors. (If a JSON parse error surfaces, fix the comma placement.)

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/services/apis/world.ts languages/en_US.json
git commit -m "feat(frontend): worldBackup API + i18n keys" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `World.vue` — Back up world button

**Files:**
- Modify: `frontend/src/widgets/instance/World.vue`

- [ ] **Step 1: Import the icon and the API**

Add `SaveOutlined` to the `@ant-design/icons-vue` import block (alongside `CloudDownloadOutlined` etc.):

```typescript
import {
  CloudDownloadOutlined,
  UploadOutlined,
  DeleteOutlined,
  RollbackOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
  SaveOutlined
} from "@ant-design/icons-vue";
```

Add `worldBackup` to the `@/services/apis/world` import block:

```typescript
import {
  worldInfo,
  worldDownloadAddress,
  worldReplace,
  worldReset,
  worldBackup,
  worldTaskStatus,
  type WorldInfo
} from "@/services/apis/world";
```

- [ ] **Step 2: Add the handler**

Add this `onBackup` function in the `<script setup>` (e.g. right after the `onReset` function, before `toConsole`):

```typescript
const onBackup = async () => {
  try {
    const { execute } = worldBackup();
    const res = await execute({ params: { uuid: instanceId, daemonId } });
    if (res.value?.taskId) {
      pollTask(res.value.taskId, t("TXT_CODE_world_task_backup_done"));
    }
  } catch (e: any) {
    reportErrorMsg(e?.message || String(e));
  }
};
```

- [ ] **Step 3: Add the button (after Download, before Replace)**

In the buttons `<div>`, insert this button immediately AFTER the Download `<a-button>` block and BEFORE the Replace `<a-button>`:

```vue
              <a-button
                :disabled="taskRunning || uploading || !info?.exists"
                @click="onBackup"
              >
                <template #icon><SaveOutlined /></template>
                {{ t("TXT_CODE_world_backup_btn") }}
              </a-button>
```

- [ ] **Step 4: Add the hint line**

In the hint paragraph, insert the backup hint between the download hint and the replace hint:

```vue
            <a-typography-paragraph type="secondary" style="margin-top: 12px">
              {{ downloadHint }}<br />
              {{ t("TXT_CODE_world_backup_hint") }}<br />
              {{ t("TXT_CODE_world_replace_hint") }}<br />
              {{ t("TXT_CODE_world_reset_hint") }}
            </a-typography-paragraph>
```

- [ ] **Step 5: Verify the frontend type-checks**

Run: `npm run type-check --prefix frontend`
Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/widgets/instance/World.vue
git commit -m "feat(frontend): Back up world button on the World card" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full build gate + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Full local build/type-check**

```powershell
npm run build --prefix daemon
npm run build --prefix panel
npm run type-check --prefix frontend
```
Expected: all clean.

- [ ] **Step 2: Publish & verify**

Both images changed (daemon: new task + event; web: panel + frontend + languages). The controller can publish `:test` via `gh workflow run docker.yml --ref test -R Dpavlakis/NexCraft`. Then manual Test-stack check:
- On a **Java** instance with the server **RUNNING**, open World → click **Back up world** → button/section shows progress → toast "World backed up" → the server **does not stop** → a `world-<ts>.zip` appears in the **Backups** card and **restores** cleanly.
- Repeat on a **Bedrock** instance.
- Confirm a clear error when the instance has **no world** yet, and that Download/Replace/Reset still work and are disabled while a backup runs.

- [ ] **Step 3: (After user confirms) update memory**

Note the World backup button shipped (commits), pending/after Test-stack verification.

---

## Self-Review

**Spec coverage:**
- Restorable world-only backup via `backupActiveWorld` → Task 1. ✓
- Tracked async task + `task_status` polling (reused) → Task 1 `toObject` shape + Task 5 `pollTask`. ✓
- Hot (no stop, no status change) → Task 1 (no `inst.status(...)` calls, no stop/restart). ✓
- `world/backup` event + panel `/backup` route → Tasks 2, 3. ✓
- Frontend API + button + hint, no confirm → Tasks 4, 5. ✓
- No-world / BUSY / STARTING errors → Task 1 guards. ✓
- i18n keys → Task 4, consumed in Task 5. ✓
- Java + Bedrock → inherent (the daemon helpers handle both). ✓

**Placeholder scan:** No TBD/TODO; all code complete.

**Type consistency:** `worldBackup` returns `{ taskId }` (Task 4) consumed by `pollTask` (Task 5, existing helper). `WorldBackupTask.toObject()` returns the same shape `worldTaskStatus`/`world/task_status` already parse. Daemon event name `world/backup` matches the panel request string and the panel path `/backup` matches the frontend `worldBackup` url `/api/protected_world/backup`. i18n keys added in Task 4 are exactly those referenced in Tasks 1/5.
