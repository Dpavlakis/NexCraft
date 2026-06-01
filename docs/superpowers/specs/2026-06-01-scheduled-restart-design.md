# Scheduled Restart with In-Game Warning (#14) — Design

**Status:** Approved 2026-06-01 (brainstorm complete). Ready for `writing-plans` → subagent-driven execution.
Branch: `test`. First of two sequential features (this, then #16 sleep-on-empty). Both live in a new **Automation** tab in Instance Settings.

## Goal
Let an admin schedule automatic server restarts with an in-game countdown so players get warned before the server goes down. A per-instance toggle + schedule + configurable warning intervals; the daemon broadcasts `say` warnings then restarts. First-class feature — the user enables it and picks a schedule; no manual multi-action wiring.

## Why a dedicated service (not the existing schedule chain)
The existing schedule system (`system_instance_control.ts`) supports multi-action chains (Command→Delay→Restart), but wiring a correct countdown by hand is tedious and error-prone. A dedicated `scheduled_restart_service.ts` owns its own `node-schedule` job per instance, runs the warning loop internally, and persists config on the instance — cleaner, self-contained, and easy to surface as one toggle in the UI. It does NOT touch or depend on the general schedule subsystem.

## Config — `daemon/src/entity/instance/Instance_config.ts`
Add to the instance config (mirrors the shape of existing `eventTask`):
```typescript
scheduledRestart = {
  enabled: false,
  scheduleType: 2,            // 1 = Interval (every N seconds), 2 = Cron
  cron: "0 4 * * *",          // used when scheduleType === 2 (default: daily 04:00)
  intervalSeconds: 21600,     // used when scheduleType === 1 (default: 6h)
  warningSeconds: [300, 60, 10], // countdown points before restart
  warningMessage: "Server restarting in {time}..." // {time} -> humanized, e.g. "5 minutes"
};
```
Persisted via the existing `StorageSubsystem.store("InstanceConfig", ...)` path (no new persistence work).

## Daemon — `daemon/src/service/scheduled_restart_service.ts` (new)
A small singleton subsystem, modeled on how `system_instance_control.ts` manages `node-schedule` jobs:
- `applyForInstance(instance)` — (re)reads `instance.config.scheduledRestart`; cancels any existing job for that uuid; if `enabled`, schedules a new job:
  - `scheduleType === 2` → `nodeSchedule.scheduleJob(cron, fn)`.
  - `scheduleType === 1` → an interval wrapper (min 60s guard), same pattern as the schedule subsystem's `IntervalJob`.
- `cancelForInstance(uuid)` — cancels + forgets the job.
- The job's `fn` = `runRestartSequence(instance)`:
  1. If `instance.status() !== RUNNING` → log "skipped (not running)" and return (no warnings into the void).
  2. Sort `warningSeconds` descending. For each `w` (e.g. 300): `say` the warning with `{time}` humanized (300→"5 minutes", 60→"1 minute", 10→"10 seconds"), then `sleep` until the next warning point (i.e. `(w - nextW) * 1000`; after the last, `sleep(lastW * 1000)`).
     - Send via `instance.execPreset("command", "say <msg>")` — universal stdin path (works Java + Bedrock). Guard each send in try/catch so a transient failure doesn't abort the restart.
     - Abort the loop early if the instance leaves RUNNING (someone stopped it mid-countdown).
  3. After the countdown: `instance.execPreset("restart")`.
- Lifecycle wiring:
  - On daemon boot, after instances load, call `applyForInstance` for each (re-arm schedules). Hook where instances are initialized (the same place `eventTask.autoStart` is honored).
  - When an instance's config is saved with new `scheduledRestart`, call `applyForInstance` to re-arm. (The save path already persists config; add the re-arm call.)
  - On instance delete, `cancelForInstance`.

`{time}` humanizer: a tiny helper (seconds → "N hour(s)/minute(s)/second(s)"), i18n-agnostic on the daemon (the message template itself is user-provided/defaulted English; the panel can offer a localized default).

## Daemon router — `daemon/src/routers/` (extend, no new file needed)
The config is saved through the existing instance-config update path (the panel already sends the full `config` object on save). So **no new daemon action is strictly required** — when the instance config is updated, the config-update handler must call `scheduledRestartService.applyForInstance(instance)` after persisting. Add that call to the existing config-update handler (find where `instance/update` / `parameters()` persists config). If a dedicated re-arm trigger is cleaner, add `routerApp.on("schedule_restart/apply", ...)` — but prefer hooking the existing update path.

## Panel
No new endpoints needed if config rides the existing instance-config update. Confirm the instance-config update proxy passes the new `scheduledRestart` object through (it forwards the whole config object, so it should "just work"). Op-log: optional — reuse the existing instance-config-update log.

## Frontend — `frontend/src/widgets/instance/dialogs/InstanceDetail.vue`
Add a new **Automation** tab (`TabSettings.Automation`) after Advanced, admin-gated like the rest of the dialog. This spec adds the **Scheduled Restart** section; #16 will add a Sleep-on-Empty section to the same tab.

Scheduled Restart section:
- **Enable** switch (`formData.instance.config.scheduledRestart.enabled`).
- When enabled, show:
  - **Schedule type** radio: Interval / Cron (reuse the labels the schedule dialog uses).
  - Interval → a number input (hours, converted to `intervalSeconds`).
  - Cron → a text input for the cron expression (with a hint + the default `0 4 * * *`), or reuse the existing cycle picker if easy.
  - **Warning countdown** — an input for the comma-separated minutes/seconds (default "5m, 1m, 10s" → `[300,60,10]`); store as `warningSeconds: number[]`. Keep parsing simple and validated (positive ints, descending).
  - **Warning message** — text input bound to `warningMessage`, with a note that `{time}` is replaced by the countdown.
- Save: the new config object is part of `formData.instance.config` and persists with the existing Save flow (same as MOTD/other fields). On successful save the daemon re-arms via `applyForInstance`.

i18n keys (en_US.json) for all labels/hints/defaults (`TXT_CODE_automation_*`, `TXT_CODE_sched_restart_*`).

## Edge cases
- Server not running when the job fires → skip cleanly (logged).
- Server stopped mid-countdown → abort remaining warnings + the restart (don't start a server the admin just stopped).
- `warningSeconds` empty → restart immediately with no warnings (valid).
- Daemon restart → schedules re-armed from persisted config on boot.
- Both Java and Bedrock: `say` over stdin works on both; restart preset works on both.
- Interval guard: minimum 60s to avoid a pathological tight loop.

## Out of scope
- No "restart only if empty" logic here (that's adjacent to #16; keep #14 a pure scheduled restart). Could be a future checkbox.
- No multi-message-per-interval or per-player titles/action-bar (just `say` chat broadcast).

## Verification
1. `npm run build --prefix daemon` · `npm run build --prefix panel` · `npm run type-check --prefix frontend` — clean; `en_US.json` valid.
2. Manual (Test stack): enable Scheduled Restart on a running Java instance with a near-future cron (e.g. `* * * * *` for a 1-min test) and warnings `[30,10,5]` → observe `say` broadcasts in the console at the right offsets, then a restart. Repeat on Bedrock. Disable → no restart. Stop the server before the job → job logs "skipped". Restart the daemon → schedule still armed.
