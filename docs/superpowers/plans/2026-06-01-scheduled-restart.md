# Scheduled Restart with In-Game Warning (#14) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Per-instance scheduled automatic restarts with an in-game `say` countdown, configured from a new "Automation" tab in Instance Settings.

**Architecture:** New config field `scheduledRestart` on the instance config (typed once in `common/global.d.ts`, defaulted in daemon `Instance_config.ts`). A new daemon singleton `scheduled_restart_service.ts` arms a per-instance `node-schedule` cron job (or interval) that runs a warning loop (`say` over stdin via `execPreset("command", ...)`) then `execPreset("restart")`. Re-armed on config save and on daemon boot. Frontend adds an Automation tab with the config UI; it persists through the existing instance-config save flow.

**Tech Stack:** TypeScript, `node-schedule` (already a dep), Koa, Vue 3 + Ant Design Vue + vue-i18n.

---

## Conventions
- No test runner — gate is **`npm run build --prefix daemon`** / **`--prefix panel`** / **`npm run type-check --prefix frontend`** + `en_US.json` validity. PowerShell PATH prefix before npm/node:
  ```powershell
  $env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
  ```
- Branch `test` (checked out). Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Spec: `docs/superpowers/specs/2026-06-01-scheduled-restart-design.md`.
- **Config type is single-source:** `common/global.d.ts` `IGlobalInstanceConfig` — both daemon `Instance_config.ts` and frontend conform to it. Add the field there once.

## File map
- Modify: `common/global.d.ts` — add `scheduledRestart` to `IGlobalInstanceConfig`.
- Modify: `daemon/src/entity/instance/Instance_config.ts` — default the field.
- Modify: `daemon/src/entity/instance/instance.ts` — apply `scheduledRestart` in `parameters()` + re-arm after persist.
- Create: `daemon/src/service/scheduled_restart_service.ts` — the scheduler singleton.
- Modify: `daemon/src/service/system_instance.ts` — re-arm each instance at boot.
- Modify: `frontend/src/widgets/instance/dialogs/InstanceDetail.vue` — Automation tab + Scheduled Restart section.
- Modify: `languages/en_US.json` — i18n.

---

## Task 1: Config type + daemon default

**Files:** `common/global.d.ts`, `daemon/src/entity/instance/Instance_config.ts`

- [ ] **Step 1: Add the type to `common/global.d.ts`**

In `IGlobalInstanceConfig`, immediately after the `eventTask: {...};` block (the one with `autoStart`/`autoStartDelay`), add:
```typescript
  scheduledRestart: {
    enabled: boolean;
    scheduleType: number; // 1 = interval (every N seconds), 2 = cron
    cron: string;
    intervalSeconds: number;
    warningSeconds: number[];
    warningMessage: string;
  };
```

- [ ] **Step 2: Default it in daemon `Instance_config.ts`**

In `daemon/src/entity/instance/Instance_config.ts`, immediately after the `public eventTask = { ... };` block, add:
```typescript
  // Scheduled automatic restart with in-game countdown warnings (#14)
  public scheduledRestart = {
    enabled: false,
    scheduleType: 2, // 1 = interval, 2 = cron
    cron: "0 4 * * *", // default: daily 04:00
    intervalSeconds: 21600, // default: 6h (used when scheduleType === 1)
    warningSeconds: [300, 60, 10],
    warningMessage: "Server restarting in {time}..."
  };
```

- [ ] **Step 3: Build daemon (type gate)**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
```
Expected: compiles. (If `InstanceConfig implements IGlobalInstanceConfig` errors because the new required field isn't present, the Step 2 default provides it — make sure the property name matches exactly.)

- [ ] **Step 4: Commit**
```powershell
git add common/global.d.ts daemon/src/entity/instance/Instance_config.ts
git commit -m @'
feat(#14): scheduledRestart config field (type + daemon default)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 2: The scheduled-restart service

**Files:** Create `daemon/src/service/scheduled_restart_service.ts`

- [ ] **Step 1: Create the service file**

```typescript
import schedule from "node-schedule";
import Instance from "../entity/instance/instance";
import logger from "./log";
import { sleep } from "../utils/sleep";

// Humanize a seconds value for the {time} placeholder in warning messages.
function humanizeSeconds(s: number): string {
  if (s % 3600 === 0 && s >= 3600) {
    const h = s / 3600;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  if (s % 60 === 0 && s >= 60) {
    const m = s / 60;
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  return `${s} second${s === 1 ? "" : "s"}`;
}

interface IRestartJob {
  cancel(): void;
}

class IntervalRestartJob implements IRestartJob {
  private handle: ReturnType<typeof setInterval>;
  constructor(callback: () => void, seconds: number) {
    this.handle = setInterval(callback, seconds * 1000);
  }
  cancel() {
    clearInterval(this.handle);
  }
}

class ScheduledRestartService {
  private jobs = new Map<string, IRestartJob>();
  // Guards against overlapping runs (a long countdown still running when the next fires).
  private running = new Set<string>();

  // (Re)arm the scheduled restart for an instance from its current config.
  public applyForInstance(instance: Instance) {
    const uuid = instance.instanceUuid;
    this.cancelForInstance(uuid);
    const cfg = instance.config?.scheduledRestart;
    if (!cfg || !cfg.enabled) return;

    const run = () => {
      this.runRestartSequence(instance).catch((e) =>
        logger.error(`[scheduledRestart] ${uuid} error: ${e?.message ?? e}`)
      );
    };

    try {
      if (cfg.scheduleType === 1) {
        const secs = Math.max(60, Number(cfg.intervalSeconds) || 0);
        this.jobs.set(uuid, new IntervalRestartJob(run, secs));
      } else {
        const job = schedule.scheduleJob(cfg.cron, run);
        if (!job) {
          logger.warn(`[scheduledRestart] ${uuid} invalid cron: ${cfg.cron}`);
          return;
        }
        this.jobs.set(uuid, { cancel: () => job.cancel() });
      }
      logger.info(`[scheduledRestart] armed ${uuid} (type=${cfg.scheduleType})`);
    } catch (e: any) {
      logger.error(`[scheduledRestart] ${uuid} failed to arm: ${e?.message ?? e}`);
    }
  }

  public cancelForInstance(uuid: string) {
    const j = this.jobs.get(uuid);
    if (j) {
      try {
        j.cancel();
      } catch {}
      this.jobs.delete(uuid);
    }
  }

  // Broadcast the countdown then restart. Skips if not running; aborts if the
  // instance leaves RUNNING mid-countdown (e.g. admin stopped it).
  private async runRestartSequence(instance: Instance) {
    const uuid = instance.instanceUuid;
    if (this.running.has(uuid)) return;
    if (instance.status() !== Instance.STATUS_RUNNING) {
      logger.info(`[scheduledRestart] ${uuid} skipped (not running)`);
      return;
    }
    this.running.add(uuid);
    try {
      const cfg = instance.config.scheduledRestart;
      const tmpl = cfg.warningMessage || "Server restarting in {time}...";
      const points = [...(cfg.warningSeconds || [])]
        .map((n) => Math.floor(Number(n)))
        .filter((n) => n > 0)
        .sort((a, b) => b - a);

      for (let i = 0; i < points.length; i++) {
        if (instance.status() !== Instance.STATUS_RUNNING) {
          logger.info(`[scheduledRestart] ${uuid} aborted mid-countdown (not running)`);
          return;
        }
        const w = points[i];
        const msg = tmpl.replace("{time}", humanizeSeconds(w));
        try {
          await instance.execPreset("command", `say ${msg}`);
        } catch (e: any) {
          logger.warn(`[scheduledRestart] ${uuid} say failed: ${e?.message ?? e}`);
        }
        const next = i + 1 < points.length ? points[i + 1] : 0;
        const waitMs = (w - next) * 1000;
        if (waitMs > 0) await sleep(waitMs);
      }

      if (instance.status() !== Instance.STATUS_RUNNING) {
        logger.info(`[scheduledRestart] ${uuid} aborted before restart (not running)`);
        return;
      }
      logger.info(`[scheduledRestart] ${uuid} restarting now`);
      await instance.execPreset("restart");
    } finally {
      this.running.delete(uuid);
    }
  }
}

export default new ScheduledRestartService();
```

- [ ] **Step 2: Verify imports resolve**

Confirm `../utils/sleep` exports `sleep` (it's used by `world_replace_task.ts` as `import { sleep } from "../../utils/sleep"`, so from `service/` it's `../utils/sleep`) and `./log` default-exports `logger`. If either path differs, fix to match the real module (Grep for `from "../utils/sleep"` and `import logger from` in other `daemon/src/service/*.ts`).

- [ ] **Step 3: Build daemon**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
```
Expected: compiles, no TS errors.

- [ ] **Step 4: Commit**
```powershell
git add daemon/src/service/scheduled_restart_service.ts
git commit -m @'
feat(#14): scheduled-restart service (cron/interval + say-countdown + restart)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 3: Wire re-arm on config-save and on boot

**Files:** `daemon/src/entity/instance/instance.ts`, `daemon/src/service/system_instance.ts`

- [ ] **Step 1: Apply `scheduledRestart` in `parameters()` + re-arm after persist**

In `daemon/src/entity/instance/instance.ts`, add the import at the top (with the other service imports):
```typescript
import scheduledRestartService from "../../service/scheduled_restart_service";
```
(Confirm the relative path: `instance.ts` is in `daemon/src/entity/instance/`, the service is in `daemon/src/service/`, so `../../service/scheduled_restart_service` is correct.)

In the `parameters(cfg, persistence = true)` method, find the `if (cfg.eventTask) { ... }` block and add an analogous block right after it so incoming config is applied:
```typescript
    if (cfg.scheduledRestart) {
      const sr = this.config.scheduledRestart;
      const inSr = cfg.scheduledRestart;
      if (inSr.enabled != null) sr.enabled = Boolean(inSr.enabled);
      if (inSr.scheduleType != null) sr.scheduleType = Number(inSr.scheduleType);
      if (inSr.cron != null) sr.cron = String(inSr.cron);
      if (inSr.intervalSeconds != null) sr.intervalSeconds = Number(inSr.intervalSeconds);
      if (Array.isArray(inSr.warningSeconds))
        sr.warningSeconds = inSr.warningSeconds.map((n: any) => Math.floor(Number(n))).filter((n: number) => n > 0);
      if (inSr.warningMessage != null) sr.warningMessage = String(inSr.warningMessage);
    }
```
Then find where the method persists config — the line `StorageSubsystem.store("InstanceConfig", this.instanceUuid, this.config);` (inside the `if (persistence)` block). Immediately AFTER that store call (still inside the method, after the persistence block), add:
```typescript
    // Re-arm the scheduled restart whenever config is applied.
    scheduledRestartService.applyForInstance(this);
```
(Placing it after the whole persist block ensures the stored config reflects the new schedule before arming.)

- [ ] **Step 2: Re-arm each instance at daemon boot**

In `daemon/src/service/system_instance.ts`, add the import near the top:
```typescript
import scheduledRestartService from "./scheduled_restart_service";
```
In `loadInstances()`, inside the `instanceConfigs.forEach(...)` loop, right after `this.addInstance(instance);`, add:
```typescript
      scheduledRestartService.applyForInstance(instance);
```

- [ ] **Step 3: Build daemon**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
```
Expected: compiles. (Watch for a circular-import issue: `instance.ts` importing the service which imports `instance.ts` only for the `Instance` TYPE — since the service imports `Instance` for typing and uses it at runtime only via the passed argument + static constants, this is fine in webpack. If a runtime circular error appears, change the service's `Instance` import to `import type Instance` and reference `Instance.STATUS_RUNNING` via the passed instance's constructor instead — but try the straightforward way first.)

- [ ] **Step 4: Commit**
```powershell
git add daemon/src/entity/instance/instance.ts daemon/src/service/system_instance.ts
git commit -m @'
feat(#14): re-arm scheduled restart on config save and daemon boot

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 4: i18n

**Files:** `languages/en_US.json`

- [ ] **Step 1: Add keys (near other instance-settings keys)**
```json
  "TXT_CODE_automation_tab": "Automation",
  "TXT_CODE_sched_restart_title": "Scheduled Restart",
  "TXT_CODE_sched_restart_desc": "Automatically restart this server on a schedule, with an in-game countdown warning to players.",
  "TXT_CODE_sched_restart_enable": "Enable scheduled restart",
  "TXT_CODE_sched_restart_type": "Schedule",
  "TXT_CODE_sched_restart_type_interval": "Every N hours",
  "TXT_CODE_sched_restart_type_cron": "Cron expression",
  "TXT_CODE_sched_restart_interval_hours": "Restart every (hours)",
  "TXT_CODE_sched_restart_cron": "Cron expression",
  "TXT_CODE_sched_restart_cron_hint": "Standard cron, e.g. \"0 4 * * *\" = daily at 04:00.",
  "TXT_CODE_sched_restart_warnings": "Warning countdown",
  "TXT_CODE_sched_restart_warnings_hint": "Comma-separated times before restart, e.g. \"5m, 1m, 10s\". Each sends an in-game message.",
  "TXT_CODE_sched_restart_message": "Warning message",
  "TXT_CODE_sched_restart_message_hint": "Shown in chat. {time} is replaced by the countdown (e.g. \"5 minutes\").",
```

- [ ] **Step 2: Validate JSON**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
node -e "JSON.parse(require('fs').readFileSync('languages/en_US.json','utf8')); console.log('OK')"
```
Expected: `OK`.

- [ ] **Step 3: Commit**
```powershell
git add languages/en_US.json
git commit -m @'
feat(#14): i18n for the Automation tab + Scheduled Restart

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 5: Frontend — Automation tab + Scheduled Restart UI

**Files:** `frontend/src/widgets/instance/dialogs/InstanceDetail.vue`

READ the file first: the `TabSettings` enum (~lines 65-80), the Advanced tab-pane and where it closes (`</a-tab-pane>` ~line 1134, before the Docker tab-pane), and how `formData.instance.config` binds + the Save flow.

- [ ] **Step 1: Add `Automation` to the `TabSettings` enum**

Insert before `ResLimit` (so existing numeric usage is unaffected at the end — order only matters for display, keys are referenced by name):
```typescript
  // eslint-disable-next-line no-unused-vars
  Automation,
```

- [ ] **Step 2: Add a helper to parse/format the warning list**

In `<script setup>`, add a computed proxy so the UI edits a friendly string while the model stays `number[]`. Place near other computeds:
```typescript
const warningSecondsText = computed({
  get: () => {
    const arr = formData.value.instance?.config?.scheduledRestart?.warningSeconds ?? [];
    return arr
      .map((s) => (s % 3600 === 0 && s >= 3600 ? `${s / 3600}h` : s % 60 === 0 && s >= 60 ? `${s / 60}m` : `${s}s`))
      .join(", ");
  },
  set: (val: string) => {
    if (!formData.value.instance?.config?.scheduledRestart) return;
    const parsed = String(val)
      .split(",")
      .map((tok) => {
        const t = tok.trim().toLowerCase();
        const m = t.match(/^(\d+)\s*([hms]?)$/);
        if (!m) return NaN;
        const n = Number(m[1]);
        return m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : n; // bare number = seconds
      })
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => b - a);
    formData.value.instance.config.scheduledRestart.warningSeconds = parsed as number[];
  }
});
```
Also add an interval-hours proxy:
```typescript
const restartIntervalHours = computed({
  get: () => {
    const s = formData.value.instance?.config?.scheduledRestart?.intervalSeconds ?? 21600;
    return Math.round((s / 3600) * 100) / 100;
  },
  set: (h: number) => {
    if (!formData.value.instance?.config?.scheduledRestart) return;
    formData.value.instance.config.scheduledRestart.intervalSeconds = Math.max(1, Math.round(Number(h) * 3600));
  }
});
```

- [ ] **Step 3: Add the Automation tab-pane**

Insert this BETWEEN the end of the Advanced tab-pane (`</a-tab-pane>` ~line 1134) and the start of the Docker tab-pane. Gate it like the other admin tabs (the dialog is already admin-only; just guard against template/global like neighbors do — match the Advanced pane's guard if it has one, else no `v-if` beyond `!isGlobalTerminal`):
```vue
          <a-tab-pane
            v-if="!isGlobalTerminal && !isTemplateMode"
            :key="TabSettings.Automation"
            :tab="t('TXT_CODE_automation_tab')"
          >
            <a-form-item v-if="formData.instance.config?.scheduledRestart">
              <a-typography-title :level="5">{{ t("TXT_CODE_sched_restart_title") }}</a-typography-title>
              <a-typography-paragraph>
                <a-typography-text type="secondary">{{ t("TXT_CODE_sched_restart_desc") }}</a-typography-text>
              </a-typography-paragraph>

              <a-switch
                v-model:checked="formData.instance.config.scheduledRestart.enabled"
                :checked-children="t('TXT_CODE_sched_restart_enable')"
                class="mb-12"
              />

              <template v-if="formData.instance.config.scheduledRestart.enabled">
                <div class="mt-12">
                  <a-typography-text strong>{{ t("TXT_CODE_sched_restart_type") }}</a-typography-text>
                  <a-radio-group
                    v-model:value="formData.instance.config.scheduledRestart.scheduleType"
                    class="ml-8"
                  >
                    <a-radio :value="2">{{ t("TXT_CODE_sched_restart_type_cron") }}</a-radio>
                    <a-radio :value="1">{{ t("TXT_CODE_sched_restart_type_interval") }}</a-radio>
                  </a-radio-group>
                </div>

                <div v-if="formData.instance.config.scheduledRestart.scheduleType === 2" class="mt-8">
                  <a-typography-text>{{ t("TXT_CODE_sched_restart_cron") }}</a-typography-text>
                  <a-input
                    v-model:value="formData.instance.config.scheduledRestart.cron"
                    style="max-width: 320px"
                    placeholder="0 4 * * *"
                  />
                  <div><a-typography-text type="secondary">{{ t("TXT_CODE_sched_restart_cron_hint") }}</a-typography-text></div>
                </div>

                <div v-else class="mt-8">
                  <a-typography-text>{{ t("TXT_CODE_sched_restart_interval_hours") }}</a-typography-text>
                  <a-input-number v-model:value="restartIntervalHours" :min="0.05" :step="1" style="max-width: 160px; display: block" />
                </div>

                <div class="mt-12">
                  <a-typography-text>{{ t("TXT_CODE_sched_restart_warnings") }}</a-typography-text>
                  <a-input v-model:value="warningSecondsText" style="max-width: 320px" placeholder="5m, 1m, 10s" />
                  <div><a-typography-text type="secondary">{{ t("TXT_CODE_sched_restart_warnings_hint") }}</a-typography-text></div>
                </div>

                <div class="mt-12">
                  <a-typography-text>{{ t("TXT_CODE_sched_restart_message") }}</a-typography-text>
                  <a-input
                    v-model:value="formData.instance.config.scheduledRestart.warningMessage"
                    style="max-width: 420px"
                    placeholder="Server restarting in {time}..."
                  />
                  <div><a-typography-text type="secondary">{{ t("TXT_CODE_sched_restart_message_hint") }}</a-typography-text></div>
                </div>
              </template>
            </a-form-item>
          </a-tab-pane>
```
Notes: `isGlobalTerminal` and `isTemplateMode` are existing computeds in this file (used by other tabs — confirm the exact names by grep; if they differ, match). If the dialog doesn't have `isTemplateMode`, use whatever guard the Advanced/Minecraft panes use. The `scheduledRestart` config object is guaranteed present on any real instance (daemon defaults it), and the `v-if="formData.instance.config?.scheduledRestart"` guard prevents a render crash on the brief load window.

- [ ] **Step 4: Type-check the frontend**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run type-check --prefix frontend
```
Expected: no errors. (The `IGlobalInstanceConfig.scheduledRestart` type from Task 1 makes the bindings type-check. If `a-input-number`/`a-radio` value typing complains, adjust `:value`/`v-model` per the project's Ant version — match existing usages in the same file.)

- [ ] **Step 5: Commit**
```powershell
git add frontend/src/widgets/instance/dialogs/InstanceDetail.vue
git commit -m @'
feat(#14): Automation tab with Scheduled Restart config UI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 6: Build verification + push

- [ ] **Step 1: Full builds**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
npm run build --prefix panel
npm run type-check --prefix frontend
```
Expected: all clean. (Panel bundles daemon source, so a daemon type error would surface here too.)

- [ ] **Step 2: Push**
```powershell
git push origin test
```

- [ ] **Step 3: Hand off for manual verification (both images)**

Rebuild `nexcraft-web` + `nexcraft-daemon` `:test`, force-update both Test containers, then on a running **Java** instance: Instance Settings → **Automation** tab → enable Scheduled Restart, pick Cron `* * * * *` (every minute) with warnings `30s, 10s, 5s` for a quick test → Save. Watch the instance console: at the top of the next minute you should see `say` broadcasts at 30s/10s/5s before restart, then a restart. Confirm: disable → no restart; stop the server before it fires → console logs "skipped"; restart the daemon → schedule still armed. Repeat the enable/save on a **Bedrock** instance (the `say` + restart both work on Bedrock).

---

## Self-Review

**Spec coverage:** per-instance enable + schedule (interval/cron) → Task 1 config + Task 5 UI ✓ · warning intervals + `say` countdown via stdin → Task 2 `runRestartSequence` (`execPreset("command", "say ...")`) ✓ · skip if not running / abort mid-countdown → Task 2 guards ✓ · dedicated `scheduled_restart_service.ts` (not the schedule chain) → Task 2 ✓ · re-arm on config save + boot → Task 3 ✓ · `{time}` humanizer → Task 2 `humanizeSeconds` ✓ · config fields in `Instance_config.ts` + persisted → Task 1 (default) + existing `StorageSubsystem.store` ✓ · no new panel endpoint (rides existing instance-config update) → confirmed (config flows through `instance/update` → `parameters()`) ✓ · Automation tab, admin-gated → Task 5 ✓ · interval min 60s guard → Task 2 `Math.max(60, ...)` ✓ · i18n → Task 4 ✓ · Java + Bedrock → `say`/restart presets work on both ✓.

**Placeholder scan:** All steps have concrete code. The two "match the existing guard/usage" notes (Task 5 `isTemplateMode`/Ant value typing) name the precedent to copy and are normal "conform to the file" instructions, not placeholders.

**Type consistency:** `scheduledRestart` shape identical across `common/global.d.ts` (Task 1), daemon default (Task 1), `parameters()` apply (Task 3), service reads (Task 2), and UI bindings (Task 5): `enabled`/`scheduleType`/`cron`/`intervalSeconds`/`warningSeconds:number[]`/`warningMessage`. Service singleton `export default new ScheduledRestartService()` imported as `scheduledRestartService` in both instance.ts and system_instance.ts. `execPreset("command", "say ...")` and `execPreset("restart")` match the verified presets. ✓
