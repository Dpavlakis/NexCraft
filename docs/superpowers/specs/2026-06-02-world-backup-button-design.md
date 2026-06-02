# "Back up world" button — design

**Date:** 2026-06-02
**Branch:** `test`
**Status:** approved (brainstorm) → planning next

## Problem

The per-instance **World Management** card (`World.vue`, route `/instances/world`) lets you
**Download**, **Replace**, and **Reset** the world, but there's no one-click way to take a
**restorable backup** of the current world. "Download" gives you a `.zip` on your machine; it
does not create a backup in the instance's Backups area that the Backups card can restore.

This adds a **Back up world** button that creates a restorable world-only backup.

## Goals

- One click on the World card creates a `world-<ts>.zip` in the instance's Backups area,
  **restorable from the Backups card** (a symmetric counterpart to Download).
- Reuse the existing `backupActiveWorld()` and the world async-task + `task_status` polling
  pattern (consistent with Replace/Reset).
- Java and Bedrock both supported (the underlying function already handles both).

## Non-goals

- No new backup storage/format — reuse `backupActiveWorld()` (`world-<ts>.zip`, restore-
  compatible with the Backups card / RestoreTask).
- No scheduling (the Backups card already does scheduled backups).
- No restore UI here (the Backups card already restores `world-*.zip`).
- No `save-all flush` / save-pause orchestration this round (see Open/future).

## Decisions (from brainstorm)

- **Tracked async task + progress** (not fire-and-forget): button shows a spinner, polls
  `world/task_status`, toasts on completion — robust for large worlds (e.g. 455 MB).
- **Hot backup (no stop):** the server keeps **RUNNING**; we zip the active world in the
  background without changing instance status. Matches the full Backups card's default
  (hot; stop-during-backup is opt-in there) and avoids disrupting players. Accepted caveat:
  a live Java world can be marginally inconsistent if a region file is mid-write during the
  zip. (Reset/Replace avoid this only because they stop first.)
- **No confirm dialog** — the action is non-destructive (like Download).

## Architecture

Mirrors the existing Reset path end-to-end.

### Daemon — `daemon/src/service/async_task_service/world_backup_task.ts` (new)

`WorldBackupTask extends AsyncTask`, modeled on `WorldResetTask`:

- `static TYPE = "WorldBackupTask"`, `phase: "backup" | "done"`.
- `onStart()`:
  - Reject if `instance.status()` is `STATUS_BUSY` or `STATUS_STARTING`
    (`$t("TXT_CODE_backup.busy")`) — can't snapshot mid-operation.
  - Resolve `cwd`/`kind`/`levelName`; if `getActiveWorldPaths(...).length === 0`, error with
    `$t("TXT_CODE_world.noWorld")` (no world to back up).
  - `phase = "backup"`; `println("INFO", $t("TXT_CODE_world.backup"))`;
    `await backupActiveWorld(inst)`.
  - `phase = "done"`; `println("INFO", $t("TXT_CODE_world.done"))`; then `this.stop()`.
  - On throw: `this.error(error)`.
  - **Does not** call `inst.status(...)` — the server stays in whatever running/stopped state
    it was in (hot backup; no stop/restart).
- `toObject()` returns `{ taskId, status, instanceUuid, instanceStatus, phase }` (same shape
  as `WorldResetTask`, so the existing `world/task_status` + frontend `worldTaskStatus` work
  unchanged).

### Daemon router — `daemon/src/routers/world_router.ts` (extend)

Add `world/backup` mirroring `world/reset`: look up the instance, `new WorldBackupTask(inst)`,
register/run it via the same mechanism `world/reset` uses, and `protocol.response(ctx, { taskId })`.

### Panel — `panel/src/app/routers/world_router.ts` (extend)

Add `POST /protected_world/backup` mirroring `/reset` (same ownership middleware + role):
`request("world/backup", { instanceUuid })` → returns `{ taskId }`.

### Frontend

- `frontend/src/services/apis/world.ts`: add `worldBackup` (POST → `{ taskId }`),
  same shape as `worldReset`.
- `frontend/src/widgets/instance/World.vue`:
  - A **Back up world** button placed with Download/Replace/Reset (after Download).
  - On click (no confirm): call `worldBackup`, then `pollTask(taskId, t("TXT_CODE_world_task_backup_done"))`
    (the existing helper that polls `worldTaskStatus`, toasts on done, and refreshes info).
  - Reuse the existing per-task running/disabled state so the button shows progress and other
    world actions are blocked while it runs.
  - Add a hint line under the buttons describing it (matches the existing Download/Replace/Reset
    hint lines).

### i18n (`languages/en_US.json`)

- `TXT_CODE_world_backup_btn` = "Back up world"
- `TXT_CODE_world_backup_hint` = "Save the current world to this instance's backups (restorable from the Backups card). The server keeps running."
- `TXT_CODE_world_task_backup_done` = "World backed up"

(Reuse existing `TXT_CODE_world.backup`, `TXT_CODE_world.done`, `TXT_CODE_world.noWorld`,
`TXT_CODE_backup.busy` on the daemon side.)

## Error handling / edge cases

- **No world** (`getActiveWorldPaths` empty) → task errors with `TXT_CODE_world.noWorld`.
- **BUSY / STARTING** → task errors with `TXT_CODE_backup.busy`.
- **Large world** → handled by the tracked-task UX (spinner + poll), no request timeout since
  the RPC returns a `taskId` immediately and the zip runs in the task.
- **Failure mid-zip** → `this.error(error)`; the partial `world-*.zip` is the daemon's concern
  (same as Reset/Replace safety backups today); the server is untouched (never stopped).

## Testing strategy

No unit-test runner in this repo (builds-not-tests). Gates:
- **Build/type-check:** `npm run build --prefix daemon`, `npm run build --prefix panel`,
  `npm run type-check --prefix frontend` — all clean.
- **Manual (Test stack):** on a Java instance, click **Back up world** while the server is
  RUNNING → button shows progress → toast "World backed up" → a `world-<ts>.zip` appears in the
  **Backups** card and **restores** cleanly; the server never stops. Repeat on a **Bedrock**
  instance. Confirm a clear error when there's no world yet.

## Open / future

- Optional **consistency mode**: a `save-all flush` (Java) before zipping, or a stop-during-
  backup variant, for a perfectly consistent snapshot. Deferred — hot backup is the default.

## Affected files

- New: `daemon/src/service/async_task_service/world_backup_task.ts`.
- Edit: `daemon/src/routers/world_router.ts`, `panel/src/app/routers/world_router.ts`,
  `frontend/src/services/apis/world.ts`, `frontend/src/widgets/instance/World.vue`,
  `languages/en_US.json`.
