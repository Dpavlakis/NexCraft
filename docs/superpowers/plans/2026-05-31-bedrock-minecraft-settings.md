# Bedrock Minecraft Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give Bedrock instances a Minecraft-settings tab (Server Name + Level Name + Server Icon), mirroring the Java MOTD/icon tab. Level Name is Bedrock-only and guarded with a caveat + confirm-on-change. Changes write to `server.properties` and apply on next start.

**Architecture:** A generic, whitelisted "get/set one server.properties key" path on the daemon (UTF-8, alongside the existing latin1 MOTD helpers), proxied by the panel, exposed by a frontend API, and rendered as Bedrock fields in the existing instance-settings dialog.

**Tech Stack:** TypeScript, Koa, socket.io RPC, Vue 3 + Ant Design Vue + vue-i18n.

---

## Conventions
- No test runner — gate = `npm run build --prefix daemon` / `npm run build --prefix panel` / `npm run type-check --prefix frontend` + JSON validity.
- PowerShell PATH prefix before npm/node:
  ```powershell
  $env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
  ```
- Branch `test` (checked out). Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Spec: `docs/superpowers/specs/2026-05-31-bedrock-minecraft-settings-design.md`.

## File map
- Modify: `daemon/src/service/mc_motd.ts` (add generic UTF-8 `getServerProperty`/`setServerProperty`)
- Modify: `daemon/src/routers/Instance_router.ts` (add `instance/server_property` action, whitelisted)
- Modify: `panel/src/app/routers/instance_router.ts` (add `/server_property` proxy)
- Modify: `frontend/src/services/apis/instance.ts` (add `serverProperty` API)
- Modify: `frontend/src/widgets/instance/dialogs/InstanceDetail.vue` (Bedrock tab fields + load/save)
- Modify: `languages/en_US.json` (i18n)

---

## Task 1: Daemon — generic server.properties key get/set + whitelisted action

**Files:** `daemon/src/service/mc_motd.ts`, `daemon/src/routers/Instance_router.ts`

- [ ] **Step 1: Add generic helpers to `daemon/src/service/mc_motd.ts`**

READ the file first. It already has `propsPath(instance)`, and `getMotd`/`setMotd` (latin1, with `&`/`§` colour translation). Add these NEW exports at the end — UTF-8, NO colour translation (Bedrock keys are plain text). Do NOT change the existing MOTD functions.

```typescript
// Generic single-key get/set for server.properties, UTF-8 and WITHOUT the
// MOTD colour-code translation. Used for Bedrock's server-name / level-name
// (and any other plain-text property). Java MOTD keeps its own latin1 path above.
function propRegex(key: string): RegExp {
  // Escape regex metachars in the key (keys here are simple, but be safe).
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${k}\\s*=(.*)$`, "m");
}

export function getServerProperty(instance: Instance, key: string): string {
  const file = propsPath(instance);
  if (!fs.existsSync(file)) return "";
  let txt = "";
  try {
    txt = fs.readFileSync(file, "utf-8");
  } catch {
    return "";
  }
  const m = txt.match(propRegex(key));
  return m ? m[1].trim() : "";
}

export function setServerProperty(instance: Instance, key: string, value: string): void {
  const file = propsPath(instance);
  const v = String(value ?? "");
  const re = propRegex(key);
  if (!fs.existsSync(file)) {
    if (v === "") return;
    fs.writeFileSync(file, `${key}=${v}\n`, "utf-8");
    return;
  }
  let txt = "";
  try {
    txt = fs.readFileSync(file, "utf-8");
  } catch {
    txt = "";
  }
  if (re.test(txt)) {
    txt = txt.replace(re, () => `${key}=${v}`);
  } else {
    txt = (txt && !txt.endsWith("\n") ? txt + "\n" : txt) + `${key}=${v}\n`;
  }
  fs.writeFileSync(file, txt, "utf-8");
}
```
(`Instance` is already imported as a type at the top of the file.)

- [ ] **Step 2: Add the whitelisted router action in `daemon/src/routers/Instance_router.ts`**

It already imports `{ getMotd, setMotd } from "../service/mc_motd"` and has `routerApp.on("instance/motd", ...)` (~line 575). Update the import to also bring in the new helpers, and add a new action right after the motd one:

Change the import line to:
```typescript
import { getMotd, setMotd, getServerProperty, setServerProperty } from "../service/mc_motd";
```
Add after the `instance/motd` handler:
```typescript
// Get/set a single whitelisted server.properties key (Bedrock server-name /
// level-name). data.value undefined => read; otherwise write. UTF-8, no colour codes.
const ALLOWED_SERVER_PROPS = ["server-name", "level-name"];
routerApp.on("instance/server_property", (ctx, data) => {
  try {
    const instance = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!instance) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const key = String(data.key || "");
    if (!ALLOWED_SERVER_PROPS.includes(key)) throw new Error("Access denied: property not allowed");
    if (data.value == null) {
      return protocol.response(ctx, getServerProperty(instance, key));
    }
    setServerProperty(instance, key, String(data.value));
    protocol.response(ctx, true);
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});
```

- [ ] **Step 3: Build the daemon**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
```
Expected: webpack compiles, no TS errors.

- [ ] **Step 4: Commit**
```powershell
git add daemon/src/service/mc_motd.ts daemon/src/routers/Instance_router.ts
git commit -m @'
feat(bedrock): daemon get/set whitelisted server.properties key (server-name/level-name)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 2: Panel proxy + frontend API

**Files:** `panel/src/app/routers/instance_router.ts`, `frontend/src/services/apis/instance.ts`

- [ ] **Step 1: Add the panel proxy `/server_property`**

READ `panel/src/app/routers/instance_router.ts` and find the existing `router.post("/motd", permission({ level: ROLE.ADMIN }), validator({ query: { uuid: String, daemonId: String } }), async (ctx) => { ... request("instance/motd", { instanceUuid, motd: body.motd }) ... })` (~line 338). Add an analogous handler right after it:
```typescript
router.post(
  "/server_property",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { uuid: String, daemonId: String }, body: { key: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const body = (ctx.request.body || {}) as { key: string; value?: string };
      const remoteRequest = new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId));
      const result = await remoteRequest.request("instance/server_property", {
        instanceUuid,
        key: body.key,
        value: body.value
      });
      ctx.body = result;
    } catch (error: any) {
      ctx.body = error;
    }
  }
);
```
(Match the file's actual prefix — the MOTD route lives under the same router whose prefix produces `/api/protected_instance/motd`, so this becomes `/api/protected_instance/server_property`. Use the same `RemoteRequest`/`RemoteServiceSubsystem` imports already present.)

- [ ] **Step 2: Add the frontend API in `frontend/src/services/apis/instance.ts`**

READ the file and find `getInstanceMotd` / `setInstanceMotd` (`url: "/api/protected_instance/motd", method: "POST"`). Add right after:
```typescript
export const serverProperty = useDefineApi<
  {
    params: { uuid: string; daemonId: string };
    data: { key: string; value?: string };
  },
  string | boolean
>({
  url: "/api/protected_instance/server_property",
  method: "POST"
});
```
(If `getInstanceMotd`/`setInstanceMotd` are two separate exports rather than one, follow whichever convention the file uses — a single `serverProperty` that does both read (omit `value`) and write (include `value`) is fine and matches the daemon action.)

- [ ] **Step 3: Build panel + type-check frontend**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix panel
npm run type-check --prefix frontend
```
Expected: both clean.

- [ ] **Step 4: Commit**
```powershell
git add panel/src/app/routers/instance_router.ts frontend/src/services/apis/instance.ts
git commit -m @'
feat(bedrock): panel /server_property proxy + frontend serverProperty API

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 3: i18n keys

**Files:** `languages/en_US.json`

- [ ] **Step 1: Add keys (near the existing `TXT_CODE_motd_*` keys)**
```json
  "TXT_CODE_bedrock_server_name": "Server Name",
  "TXT_CODE_bedrock_server_name_desc": "The name shown in the server list. Saved to server.properties; applies on next start.",
  "TXT_CODE_bedrock_server_name_placeholder": "Dedicated Server",
  "TXT_CODE_bedrock_level_name": "Level Name",
  "TXT_CODE_bedrock_level_name_desc": "The active world folder (worlds/<name>). Saved to server.properties; applies on next start.",
  "TXT_CODE_bedrock_level_name_warn": "Changing the level name loads or creates a different world under worlds/<name>. Your current world stays on disk under its old name.",
  "TXT_CODE_bedrock_level_name_confirm_title": "Change the active world?",
  "TXT_CODE_bedrock_level_name_confirm": "The server will load or generate worlds/<new name> on next start; the current world is kept on disk under its old name. Continue?",
```

- [ ] **Step 2: Validate**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
node -e "JSON.parse(require('fs').readFileSync('languages/en_US.json','utf8')); console.log('OK')"
```
Expected: `OK`. (Watch for duplicate keys — reconcile if any already exist.)

- [ ] **Step 3: Commit**
```powershell
git add languages/en_US.json
git commit -m @'
feat(bedrock): i18n for Bedrock Minecraft settings (server name / level name)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 4: Frontend — Bedrock fields in the instance-settings dialog

**Files:** `frontend/src/widgets/instance/dialogs/InstanceDetail.vue`

READ the file's MOTD region first (~lines 245–270 for the script: `isMinecraftJava`, `showMotd`, `motd`/`originalMotd`, `loadMotd`, `executeGetMotd`/`executeSetMotd`; the save block ~line 371 where MOTD is persisted; and the Minecraft `<a-tab-pane v-if="showMotd" ...>` at ~line 962 with the MOTD field + the SetServerIcon button).

- [ ] **Step 1: Script — add Bedrock state + computeds**

After `isMinecraftJava` (~line 249-251) add:
```typescript
const isMinecraftBedrock = computed(() =>
  Boolean(formData?.value?.instance?.config?.type?.startsWith("minecraft/bedrock"))
);
// The Minecraft tab now shows for Java OR Bedrock.
const showMinecraftTab = computed(
  () => !isTemplateMode.value && !isGlobalTerminal.value && (isMinecraftJava.value || isMinecraftBedrock.value)
);
```
Add Bedrock field refs near `motd`/`originalMotd`:
```typescript
const bedrockServerName = ref("");
const originalBedrockServerName = ref("");
const bedrockLevelName = ref("");
const originalBedrockLevelName = ref("");
```
Import the `serverProperty` API (add to the existing `@/services/apis/instance` import): `serverProperty`.
Also ensure `Modal` is imported from `ant-design-vue` (the file already imports `message` from there; add `Modal` if not present).

- [ ] **Step 2: Script — load Bedrock props on open**

In `loadMotd` (or alongside it, called from the same `onMounted`/open flow at ~line 345 where `loadMotd()` is awaited), add a loader that runs for Bedrock:
```typescript
const loadBedrockProps = async () => {
  bedrockServerName.value = "";
  originalBedrockServerName.value = "";
  bedrockLevelName.value = "";
  originalBedrockLevelName.value = "";
  if (!props.instanceId || !props.daemonId || !isMinecraftBedrock.value) return;
  try {
    const { execute } = serverProperty();
    const nameRes = await execute({
      params: { uuid: props.instanceId, daemonId: props.daemonId },
      data: { key: "server-name" }
    });
    bedrockServerName.value = String(nameRes.value ?? "");
    originalBedrockServerName.value = bedrockServerName.value;
    const { execute: execute2 } = serverProperty();
    const lvlRes = await execute2({
      params: { uuid: props.instanceId, daemonId: props.daemonId },
      data: { key: "level-name" }
    });
    bedrockLevelName.value = String(lvlRes.value ?? "");
    originalBedrockLevelName.value = bedrockLevelName.value;
  } catch (e: any) {
    reportErrorMsg(e?.message || String(e));
  }
};
```
And where `loadMotd()` is called on open, also call `loadBedrockProps()` (e.g. add to the `Promise.all([...])` at ~line 345).

- [ ] **Step 3: Script — persist Bedrock props on save**

In the save handler, near the MOTD-persist block (`if (showMotd.value && motd.value !== originalMotd.value) { ... }` ~line 371), add Bedrock persistence. Server-name writes directly; level-name confirms first:
```typescript
// Bedrock: persist server-name + level-name when changed (level-name confirmed).
if (isMinecraftBedrock.value && props.instanceId && props.daemonId) {
  if (bedrockServerName.value !== originalBedrockServerName.value) {
    const { execute } = serverProperty();
    await execute({
      params: { uuid: props.instanceId, daemonId: props.daemonId },
      data: { key: "server-name", value: bedrockServerName.value }
    });
    originalBedrockServerName.value = bedrockServerName.value;
  }
  if (bedrockLevelName.value !== originalBedrockLevelName.value) {
    const ok = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: t("TXT_CODE_bedrock_level_name_confirm_title"),
        content: t("TXT_CODE_bedrock_level_name_confirm"),
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      });
    });
    if (ok) {
      const { execute } = serverProperty();
      await execute({
        params: { uuid: props.instanceId, daemonId: props.daemonId },
        data: { key: "level-name", value: bedrockLevelName.value }
      });
      originalBedrockLevelName.value = bedrockLevelName.value;
    } else {
      bedrockLevelName.value = originalBedrockLevelName.value; // revert the field
    }
  }
}
```
(Place this so it runs as part of the same Save that handles MOTD — mirror the existing async/ordering. If the save shows a success toast at the end, leave that as-is.)

- [ ] **Step 4: Template — generalize the tab + add Bedrock fields**

Change the Minecraft tab-pane gate from `v-if="showMotd"` to `v-if="showMinecraftTab"`:
```vue
<a-tab-pane v-if="showMinecraftTab" :key="TabSettings.Minecraft" :tab="t('TXT_CODE_minecraft_tab')">
```
Inside it, keep the EXISTING Java MOTD `<a-col>` but gate it `v-if="isMinecraftJava"` (it currently says `v-if="showMotd"` — change to `isMinecraftJava`). Keep the Set Server Icon col but make it show for BOTH (remove its Java-only `v-if`, or set `v-if="isMinecraftJava || isMinecraftBedrock"` — server icon is useful for the panel glance on Bedrock too). Then ADD the Bedrock fields before the icon:
```vue
<a-col v-if="isMinecraftBedrock" :xs="24" :offset="0">
  <a-typography-title :level="5">{{ t("TXT_CODE_bedrock_server_name") }}</a-typography-title>
  <a-typography-paragraph>
    <a-typography-text type="secondary">{{ t("TXT_CODE_bedrock_server_name_desc") }}</a-typography-text>
  </a-typography-paragraph>
  <a-input v-model:value="bedrockServerName" :placeholder="t('TXT_CODE_bedrock_server_name_placeholder')" />
</a-col>
<a-col v-if="isMinecraftBedrock" :xs="24" :offset="0">
  <a-typography-title :level="5">{{ t("TXT_CODE_bedrock_level_name") }}</a-typography-title>
  <a-typography-paragraph>
    <a-typography-text type="secondary">{{ t("TXT_CODE_bedrock_level_name_desc") }}</a-typography-text>
  </a-typography-paragraph>
  <a-input v-model:value="bedrockLevelName" />
  <a-alert class="mt-8" type="warning" show-icon :message="t('TXT_CODE_bedrock_level_name_warn')" />
</a-col>
```
(Match the existing col/markup style in that tab. The Set Server Icon button uses the existing `SetServerIcon` flow — just ensure it's reachable on the Bedrock branch.)

- [ ] **Step 5: Type-check**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run type-check --prefix frontend
```
Expected: no errors. (If `Modal` import missing, add it. If `serverProperty` return typing complains, the `.value` is `string | boolean` — cast/String() as shown.)

- [ ] **Step 6: Commit**
```powershell
git add frontend/src/widgets/instance/dialogs/InstanceDetail.vue
git commit -m @'
feat(bedrock): Minecraft settings tab for Bedrock (server name + level name + icon)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 5: Build verification + push

- [ ] **Step 1: Full builds**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
npm run build --prefix panel
npm run type-check --prefix frontend
```
Expected: all clean.

- [ ] **Step 2: Push**
```powershell
git push origin test
```

- [ ] **Step 3: Hand off for manual verification (both images)**

Rebuild `nexcraft-web` + `nexcraft-daemon` `:test`, force-update both Test containers, then:
1. **Bedrock** instance → Instance Settings → **Minecraft** tab exists, shows **Server Name** + **Level Name** (with warning) + **Set Server Icon**. Set Server Name → Save → `server-name` updated in server.properties (UTF-8). Set icon → shows in Basic Info. Change Level Name → confirm dialog → on confirm, `level-name` updated; next start loads `worlds/<new-name>`; old world folder still present.
2. **Java** instance → Minecraft tab unchanged (MOTD + icon; NO Level Name field).
3. Daemon rejects a non-whitelisted property key (only server-name/level-name allowed).

---

## Self-Review

**Spec coverage:** Bedrock Server Name (`server-name`) → Tasks 1/4 ✓ · Bedrock Level Name + caveat + confirm-on-change → Task 4 Steps 3-4 ✓ · Server Icon for Bedrock → Task 4 Step 4 (reuse SetServerIcon) ✓ · Java tab unchanged (MOTD + icon, no Level Name) → Task 4 gates MOTD on `isMinecraftJava` ✓ · UTF-8 vs latin1 distinction → Task 1 (new helpers UTF-8, MOTD untouched) ✓ · whitelisted daemon action → Task 1 Step 2 ✓ · apply-on-next-start (no auto-restart) → copy in i18n + no restart call ✓ · panel proxy + frontend API mirroring MOTD → Task 2 ✓ · i18n → Task 3 ✓.

**Placeholder scan:** All code blocks are concrete; the two "match the existing pattern" steps (panel proxy, frontend API) name the exact precedent (`/motd`, `getInstanceMotd`) with full snippets. No TBD.

**Type consistency:** Daemon `getServerProperty`/`setServerProperty` + action `instance/server_property` (data `{instanceUuid, key, value?}`) ↔ panel `/server_property` (body `{key, value?}`) ↔ frontend `serverProperty` (`data:{key, value?}`, resp `string|boolean`) ↔ dialog usage. Whitelist `["server-name","level-name"]` consistent across daemon + the only keys the frontend sends. `showMinecraftTab`/`isMinecraftBedrock` names consistent between Step 1 and Step 4.
