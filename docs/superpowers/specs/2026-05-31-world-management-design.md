# World Management — Design (Active-World Model)

**Status:** Approved 2026-05-31. Ready for `writing-plans` → subagent-driven execution.
**Feature #15.** Branch: TBD (new branch off `feat/import-existing-server` or off `main` after import merges).

## Goal
Let an admin manage an instance's **single active world** from a new per-instance card: see it, download it, replace/restore it from an upload, and reset it — with an automatic safety backup before destructive operations.

## Scope decisions (confirmed with user)
- **Active world only** — no multi-world list and no active-world switching. The world is identified by `level-name` in `server.properties`.
- **Safety net = auto-backup on replace & reset only.** Download takes no backup. (Switching active is out of scope; non-destructive.)
- Java + Bedrock. Admin-gated (like the Modpack Update card).

## The card: `World.vue` (route `/instances/world`)
Nav button in `ManagerBtns.vue`. Reads `daemonId`/`instanceId` via `useLayoutCardTools`. Registered in `frontend/config/index.ts`, `frontend/config/router.ts`, default page in `panel/src/app/service/frontend_layout.ts`.

### 1. Current world panel (read-only)
Shows: active world name (`level-name`), instance type (Java/Bedrock), folder size, last-modified. Backed by daemon `world/info`.

### 2. Download world
Daemon zips the active world and returns it via the existing **signed-token download route** (`/download/:key/:fileName`, `missionPassport.setMission(key,"download")`).
- **Java:** `<level-name>.zip` bundling `<level-name>` + `<level-name>_nether` + `<level-name>_the_end` (whichever exist; modded dimensions nest inside `<level-name>/DIM*`).
- **Bedrock:** `<level-name>.mcworld` = the **contents** of `worlds/<level-name>/` zipped at root (so it also opens in the Bedrock client).
- Allowed anytime (read-only copy; no stop needed).

### 3. Replace / Restore world
Upload a world archive (`.zip` / `.mcworld`) via the existing **chunked upload + unzip transport** (the import flow: `uploadAddress()` → `POST /upload-new/:key` → `/upload-piece/:id`, lands in a temp dir).
Flow (`WorldReplaceTask`, AsyncTask + TaskCenter polling, modeled on `RestoreTask`):
1. Stop instance (`execPreset("stop")`, `waitForStop`), remember prior run state.
2. **World-only backup** of the current active world into the existing Backups area (a zip in `BACKUP_ROOT/<uuid>/` named e.g. `world-<timestamp>.zip`, containing only the active world folder(s) at the same relative paths → restore-compatible with the existing Backups card / `RestoreTask`).
3. Wipe the active world folder(s).
4. Extract the upload to a temp dir, **detect the world root** by locating `level.dat` (`findWorldRoot`), then place it under the active `level-name` location (Java: into `<level-name>/` etc.; Bedrock: into `worlds/<level-name>/`). If no `level.dat` is found anywhere in the archive → fail with a clear error (`TXT_CODE_world_no_level_dat`).
5. Restart if it was running.

### 4. Reset world
`WorldResetTask`: stop → world-only backup (step 2 above) → remove the active world folder(s) → restart if it was running (server regenerates a fresh world on next start).

### Safety / confirms
- Replace and Reset auto-backup the current world first (step 2). Each shows an explicit confirm dialog. Download does not back up.
- Destructive ops auto-stop the instance and restore its prior run state afterward.

## Backend surface
### Daemon
- `daemon/src/service/world_service.ts` (new): `getActiveWorldPaths(cwd, kind, levelName): string[]`, `findWorldRoot(dir): string|undefined` (locate `level.dat`), `zipWorld(cwd, kind, levelName, destZip, {bedrockContentsAtRoot})`, `backupActiveWorld(instance): string` (world-only zip into `BACKUP_ROOT/<uuid>/`, reuse the backup archiver), `wipeActiveWorld(cwd, kind, levelName)`, `placeWorld(srcRoot, cwd, kind, levelName)`.
  Reuse `readLevelName`/the `server.properties` parser from `modpack_files.ts`/`mc_motd.ts`; reuse `node-stream-zip` for extract and `archiver` for zip.
- `daemon/src/service/async_task_service/world_replace_task.ts` + `world_reset_task.ts` (new, AsyncTask).
- Router actions in `daemon/src/service/router.ts`: `world/info`, `world/download` (returns `{token, fileName}`), `world/replace` (returns `{taskId}`), `world/reset` (returns `{taskId}`), `world/task_status`.

### Panel
- `panel/src/app/routers/world_router.ts` (new, prefix `/protected_world`): proxy each action via `new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request("world/...", data)`. Op-log `instance_world_replace` / `instance_world_reset` (add types to `panel/src/types/operation_logger.ts`). Mount in `panel/src/app/index.ts`. Admin permission.

### Frontend
- `frontend/src/services/apis/world.ts` (new): `worldInfo`, `worldDownload`, `worldReplace`, `worldReset`, `worldTaskStatus` (`useDefineApi`).
- `frontend/src/widgets/instance/World.vue` (new) + registration (4 places above) + nav button.
- i18n keys in `languages/en_US.json` (en_US is source of truth).

## Caveats handled
- Java world spans up to 3 top-level folders (`level-name` + `_nether` + `_the_end`); modded dimensions nest inside. We zip/wipe/place the whole set.
- Uploaded archives vary in structure → detect the world root via `level.dat`; reject clearly if absent.
- Bedrock `.mcworld` is just `worlds/<name>` contents zipped at root; accept `.zip` and `.mcworld` interchangeably on upload, emit `.mcworld` on Bedrock download.
- Host/general process mode only (no Docker instances) — consistent with the rest of NexCraft.

## Verification
1. Java: download active world → zip contains `world`/`_nether`/`_the_end`. Replace with an uploaded world zip (root `level.dat`, nested `world/level.dat`, and `world_x/level.dat` variants) → world swapped, a `world-*.zip` backup appears in Backups, server starts on the new world. Reset → fresh world generated, backup taken.
2. Bedrock: download → `.mcworld` opens in client; replace from `.mcworld` → world swapped under `worlds/<level-name>`.
3. Non-admin cannot replace/reset. Download token is single-use.
4. Restore the auto-backup from the Backups card → recovers the pre-replace world.
