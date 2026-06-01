# Bedrock Player Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native Bedrock player management (online list, kick, allowlist add/remove/toggle, operator op/deop) driven by the server console, and make the Players card edition-aware so Bedrock instances get a real card instead of the misleading RCON message.

**Architecture:** A new daemon service (`bedrock_player_service.ts`) writes commands to the Bedrock Dedicated Server's stdin (`instance.execPreset("command", …)`) and reads stdout back via a temporary `instance.on("data")` listener, and reads `allowlist.json` / `permissions.json` / `server.properties` from disk. Two new daemon router events (`player/bedrock_overview`, `player/bedrock_action`) are proxied by the panel under the existing `/protected_player` router and surfaced by a new `BedrockPlayers.vue` that the existing `Players.vue` renders when the instance is Bedrock. The Java/RCON path is untouched.

**Tech Stack:** TypeScript (daemon socket-RPC routers, Koa panel routers), Vue 3 + Ant Design Vue + vue-i18n (frontend), `fs-extra` for JSON files.

**Spec:** `docs/superpowers/specs/2026-06-01-bedrock-player-management-design.md`

---

## Testing & verification note (READ FIRST)

This codebase has **no unit-test runner** (no jest/vitest/mocha script; no test files). Per the project's standing workflow ("builds-not-tests"; type-check locally before every push), each task is verified by a **clean build / type-check**, and the feature is validated by a **manual Test-stack pass** (final task). This intentionally replaces the writing-plans skill's default TDD loop, because the user's workflow takes precedence and there is no test harness to hook into.

**Verification commands** (PowerShell — each shell starts with a stale PATH, so prefix once per shell):

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
```

- Daemon build: `npm run build --prefix daemon`
- Panel build (also compiles daemon): `npm run build --prefix panel`
- Frontend type-check: `npm run type-check --prefix frontend`

All work lands on the **`test`** branch (commit straight to it). Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- **Create** `daemon/src/service/bedrock_player_service.ts` — all Bedrock player logic: pure parsers/validation/file-readers + the console helper + `getBedrockOverview` / `bedrockPlayerAction`.
- **Modify** `daemon/src/routers/player_router.ts` — add `player/bedrock_overview` + `player/bedrock_action` events (mirrors the existing `player/list` / `player/action`).
- **Modify** `panel/src/app/routers/player_router.ts` — add `GET /bedrock_overview` + `POST /bedrock_action` on the existing `/protected_player` router.
- **Modify** `frontend/src/services/apis/player.ts` — add the Bedrock types + `bedrockPlayerOverview` / `bedrockPlayerAction` API definitions.
- **Create** `frontend/src/widgets/instance/BedrockPlayers.vue` — the Bedrock card UI.
- **Modify** `frontend/src/widgets/instance/Players.vue` — branch to `BedrockPlayers.vue` when the instance is Bedrock.
- **Modify** `languages/en_US.json` — new i18n keys for the Bedrock card.

---

## Task 1: Daemon Bedrock player service

**Files:**
- Create: `daemon/src/service/bedrock_player_service.ts`

- [ ] **Step 1: Create the service file**

Create `daemon/src/service/bedrock_player_service.ts` with this exact content:

```typescript
import fs from "fs-extra";
import path from "path";
import Instance from "../entity/instance/instance";
import { getServerProperty } from "./mc_motd";

export type BedrockPlayerAction =
  | "kick"
  | "allowlist_add"
  | "allowlist_remove"
  | "allowlist_on"
  | "allowlist_off"
  | "op"
  | "deop";

export interface BedrockAllowEntry {
  name: string;
  xuid?: string;
}

export interface BedrockOperator {
  name?: string;
  xuid: string;
}

export interface BedrockPlayerOverview {
  running: boolean;
  online: string[];
  allowlist: BedrockAllowEntry[];
  allowlistEnabled: boolean;
  operators: BedrockOperator[];
}

const ACTIONS_NO_NAME: BedrockPlayerAction[] = ["allowlist_on", "allowlist_off"];

// Bedrock gamertags may contain spaces; reject control chars / quotes so the
// quoted console command can't be broken out of (command injection guard).
export function assertValidName(name: string): string {
  const n = String(name ?? "").trim();
  if (!n || n.length > 32 || /[\r\n"]/.test(n)) {
    throw new Error("Invalid player name");
  }
  return n;
}

// Parse BDS "list" output, e.g.:
//   There are 2/10 players online:
//   Alice, Bob Builder
export function parseBedrockList(text: string): string[] {
  const idx = text.toLowerCase().indexOf("players online:");
  if (idx < 0) return [];
  const after = text.slice(idx + "players online:".length);
  // Names sit on the rest of that line or the next non-empty line, comma-separated.
  const line =
    after
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0) || "";
  return line
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readJsonArray(file: string): any[] {
  try {
    if (!fs.existsSync(file)) return [];
    const data = fs.readJsonSync(file);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function readAllowlist(instance: Instance): BedrockAllowEntry[] {
  const file = path.join(instance.absoluteCwdPath(), "allowlist.json");
  return readJsonArray(file)
    .map((e) => ({
      name: String(e?.name || ""),
      xuid: e?.xuid ? String(e.xuid) : undefined
    }))
    .filter((e) => e.name);
}

export function readOperators(instance: Instance): BedrockOperator[] {
  const file = path.join(instance.absoluteCwdPath(), "permissions.json");
  const byXuid = new Map<string, string>();
  for (const a of readAllowlist(instance)) if (a.xuid) byXuid.set(a.xuid, a.name);
  return readJsonArray(file)
    .filter((e) => String(e?.permission) === "operator" && e?.xuid)
    .map((e) => {
      const xuid = String(e.xuid);
      return { xuid, name: byXuid.get(xuid) };
    });
}

export function isAllowlistEnabled(instance: Instance): boolean {
  const v =
    getServerProperty(instance, "allow-list") || getServerProperty(instance, "white-list");
  return String(v).trim().toLowerCase() === "true";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Send a command to the BDS console and capture ~settleMs of output.
async function runConsole(instance: Instance, command: string, settleMs = 1000): Promise<string> {
  if (instance.status() !== Instance.STATUS_RUNNING) {
    throw new Error("Server must be running");
  }
  const chunks: string[] = [];
  const listener = (text: any) => chunks.push(String(text));
  instance.on("data", listener);
  try {
    await instance.execPreset("command", command);
    await sleep(settleMs);
  } finally {
    instance.removeListener("data", listener);
  }
  return chunks.join("");
}

export async function getOnlineBedrockPlayers(instance: Instance): Promise<string[]> {
  if (instance.status() !== Instance.STATUS_RUNNING) return [];
  try {
    return parseBedrockList(await runConsole(instance, "list"));
  } catch {
    return [];
  }
}

export async function getBedrockOverview(instance: Instance): Promise<BedrockPlayerOverview> {
  return {
    running: instance.status() === Instance.STATUS_RUNNING,
    online: await getOnlineBedrockPlayers(instance),
    allowlist: readAllowlist(instance),
    allowlistEnabled: isAllowlistEnabled(instance),
    operators: readOperators(instance)
  };
}

export async function bedrockPlayerAction(
  instance: Instance,
  action: BedrockPlayerAction,
  name?: string
): Promise<void> {
  let command: string;
  if (ACTIONS_NO_NAME.includes(action)) {
    command = action === "allowlist_on" ? "allowlist on" : "allowlist off";
  } else {
    const n = assertValidName(String(name));
    switch (action) {
      case "kick":
        command = `kick "${n}"`;
        break;
      case "allowlist_add":
        command = `allowlist add "${n}"`;
        break;
      case "allowlist_remove":
        command = `allowlist remove "${n}"`;
        break;
      case "op":
        command = `op "${n}"`;
        break;
      case "deop":
        command = `deop "${n}"`;
        break;
      default:
        throw new Error("Invalid action");
    }
  }
  await runConsole(instance, command, 300);
}
```

- [ ] **Step 2: Verify the daemon builds**

Run: `npm run build --prefix daemon`
Expected: completes with no TypeScript errors (a `production/` bundle is written).

If `getServerProperty` is not exported from `./mc_motd`, open `daemon/src/service/mc_motd.ts` and confirm the exact export name (the spec recorded `getServerProperty(instance, key): string`); adjust the import to match.

- [ ] **Step 3: Commit**

```powershell
git add daemon/src/service/bedrock_player_service.ts
git commit -m "feat(daemon): Bedrock player service (console-driven list/kick/allowlist/op)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Daemon router events

**Files:**
- Modify: `daemon/src/routers/player_router.ts`

- [ ] **Step 1: Add the imports**

At the top of `daemon/src/routers/player_router.ts`, add an import for the new service alongside the existing imports:

```typescript
import {
  getBedrockOverview,
  bedrockPlayerAction,
  type BedrockPlayerAction
} from "../service/bedrock_player_service";
```

- [ ] **Step 2: Add the two events**

At the end of the file (after the existing `player/action` handler), append:

```typescript
// Bedrock: overview (online via console `list`, allowlist + operators from disk)
routerApp.on("player/bedrock_overview", async (ctx, data) => {
  try {
    const instance = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!instance) throw new Error($t("TXT_CODE_player.instanceNotExist"));
    protocol.response(ctx, await getBedrockOverview(instance));
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Bedrock: kick / allowlist add|remove|on|off / op | deop
routerApp.on("player/bedrock_action", async (ctx, data) => {
  try {
    const instance = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!instance) throw new Error($t("TXT_CODE_player.instanceNotExist"));
    await bedrockPlayerAction(instance, data.action as BedrockPlayerAction, data.name);
    protocol.response(ctx, true);
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});
```

> Note: `$t`, `protocol`, `routerApp`, and `InstanceSubsystem` are already imported in this file (used by the existing handlers). If `$t` turns out not to be imported, replace `$t("TXT_CODE_player.instanceNotExist")` with `new Error("Instance not found")` to match other plain-error sites in the daemon.

- [ ] **Step 3: Verify the daemon builds**

Run: `npm run build --prefix daemon`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```powershell
git add daemon/src/routers/player_router.ts
git commit -m "feat(daemon): player/bedrock_overview + player/bedrock_action router events" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Panel proxy routes

**Files:**
- Modify: `panel/src/app/routers/player_router.ts`

- [ ] **Step 1: Add the two routes**

In `panel/src/app/routers/player_router.ts`, after the existing `router.post("/action", …)` block (and before `export default router` / the router export), add:

```typescript
// Bedrock overview (online + allowlist + operators)
router.get(
  "/bedrock_overview",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    const daemonId = String(ctx.query.daemonId);
    const instanceUuid = String(ctx.query.uuid);
    ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
      "player/bedrock_overview",
      { instanceUuid }
    );
  }
);

// Bedrock action (kick / allowlist add|remove|on|off / op | deop)
router.post(
  "/bedrock_action",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String }, body: { action: String } }),
  async (ctx) => {
    const daemonId = String(ctx.query.daemonId);
    const instanceUuid = String(ctx.query.uuid);
    ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
      "player/bedrock_action",
      {
        instanceUuid,
        action: ctx.request.body.action,
        name: ctx.request.body.name
      }
    );
  }
);
```

> `name` is intentionally **not** in the body validator (the `allowlist_on`/`allowlist_off` actions carry no name). `permission`, `validator`, `ROLE`, `RemoteRequest`, and `RemoteServiceSubsystem` are already imported by the existing routes in this file.

- [ ] **Step 2: Verify the panel builds**

Run: `npm run build --prefix panel`
Expected: no TypeScript errors (this also compiles the bundled daemon source).

- [ ] **Step 3: Commit**

```powershell
git add panel/src/app/routers/player_router.ts
git commit -m "feat(panel): /protected_player bedrock_overview + bedrock_action proxy routes" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend API + i18n keys

**Files:**
- Modify: `frontend/src/services/apis/player.ts`
- Modify: `languages/en_US.json`

- [ ] **Step 1: Add the API types and definitions**

Append to `frontend/src/services/apis/player.ts` (keep the existing `playerList` / `playerAction` exports):

```typescript
export interface BedrockAllowEntry {
  name: string;
  xuid?: string;
}

export interface BedrockOperator {
  name?: string;
  xuid: string;
}

export interface BedrockPlayerOverview {
  running: boolean;
  online: string[];
  allowlist: BedrockAllowEntry[];
  allowlistEnabled: boolean;
  operators: BedrockOperator[];
}

export type BedrockActionType =
  | "kick"
  | "allowlist_add"
  | "allowlist_remove"
  | "allowlist_on"
  | "allowlist_off"
  | "op"
  | "deop";

export const bedrockPlayerOverview = useDefineApi<
  { params: { daemonId: string; uuid: string } },
  BedrockPlayerOverview
>({
  url: "/api/protected_player/bedrock_overview",
  method: "GET"
});

export const bedrockPlayerAction = useDefineApi<
  {
    params: { daemonId: string; uuid: string };
    data: { action: BedrockActionType; name?: string };
  },
  boolean
>({
  url: "/api/protected_player/bedrock_action",
  method: "POST"
});
```

> `useDefineApi` is already imported at the top of `player.ts`.

- [ ] **Step 2: Add the i18n keys**

In `languages/en_US.json`, add these keys (place them near the existing `TXT_CODE_player_*` keys; JSON — mind the trailing commas):

```json
"TXT_CODE_bedrock_allowlist": "Allowlist",
"TXT_CODE_bedrock_allowlist_enforced": "Enforce allowlist",
"TXT_CODE_bedrock_allowlist_add": "Add to allowlist",
"TXT_CODE_bedrock_allowlist_remove": "Remove",
"TXT_CODE_bedrock_add_placeholder": "Gamertag",
"TXT_CODE_bedrock_add_btn": "Add",
"TXT_CODE_bedrock_operators": "Operators",
"TXT_CODE_bedrock_allowlist_empty": "Allowlist is empty.",
"TXT_CODE_bedrock_offline": "Server is offline — the online list and console actions require it running.",
"TXT_CODE_bedrock_confirm_allowlist_on": "Enforce the allowlist? Only allowlisted players will be able to join.",
"TXT_CODE_bedrock_confirm_allowlist_off": "Stop enforcing the allowlist? Anyone will be able to join."
```

- [ ] **Step 3: Verify the frontend type-checks**

Run: `npm run type-check --prefix frontend`
Expected: no errors.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/services/apis/player.ts languages/en_US.json
git commit -m "feat(frontend): Bedrock player API + i18n keys" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: BedrockPlayers.vue component

**Files:**
- Create: `frontend/src/widgets/instance/BedrockPlayers.vue`

- [ ] **Step 1: Create the component**

Create `frontend/src/widgets/instance/BedrockPlayers.vue` with this exact content:

```vue
<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref } from "vue";
const embeddedInManageModal = inject<boolean>("embeddedInManageModal", false);
import BetweenMenus from "@/components/BetweenMenus.vue";
import CardPanel from "@/components/CardPanel.vue";
import { useAppRouters } from "@/hooks/useAppRouters";
import { useLayoutCardTools } from "@/hooks/useCardTools";
import { useScreen } from "@/hooks/useScreen";
import { t } from "@/lang/i18n";
import {
  bedrockPlayerOverview,
  bedrockPlayerAction,
  type BedrockActionType,
  type BedrockPlayerOverview
} from "@/services/apis/player";
import { reportErrorMsg } from "@/tools/validator";
import type { LayoutCard } from "@/types/index";
import { RollbackOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons-vue";
import { message, Modal } from "ant-design-vue";

const props = defineProps<{ card: LayoutCard }>();

const { isPhone } = useScreen();
const { toPage } = useAppRouters();
const { getMetaOrRouteValue } = useLayoutCardTools(props.card);
const instanceId = String(getMetaOrRouteValue("instanceId") ?? "");
const daemonId = String(getMetaOrRouteValue("daemonId") ?? "");

const data = ref<BedrockPlayerOverview>({
  running: false,
  online: [],
  allowlist: [],
  allowlistEnabled: false,
  operators: []
});
const loading = ref(false);
const newName = ref("");

const isOnAllowlist = (name: string) =>
  data.value.allowlist.some((e) => e.name.toLowerCase() === name.toLowerCase());

const load = async () => {
  const { execute } = bedrockPlayerOverview();
  try {
    loading.value = true;
    const res = await execute({ params: { daemonId, uuid: instanceId } });
    if (res.value) data.value = res.value;
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    loading.value = false;
  }
};

const act = async (action: BedrockActionType, name?: string) => {
  const { execute } = bedrockPlayerAction();
  try {
    await execute({ params: { daemonId, uuid: instanceId }, data: { action, name } });
    message.success(t("TXT_CODE_player_done"));
    setTimeout(load, 600);
  } catch (err: any) {
    reportErrorMsg(err.message);
  }
};

const confirmAct = (action: BedrockActionType, name: string, title: string) => {
  Modal.confirm({ title, content: name, onOk: () => act(action, name) });
};

const onAddAllowlist = () => {
  const name = newName.value.trim();
  if (!name) return;
  newName.value = "";
  act("allowlist_add", name);
};

const onToggleAllowlist = (checked: boolean) => {
  Modal.confirm({
    title: checked
      ? t("TXT_CODE_bedrock_confirm_allowlist_on")
      : t("TXT_CODE_bedrock_confirm_allowlist_off"),
    onOk: () => act(checked ? "allowlist_on" : "allowlist_off")
  });
};

const toConsole = () => {
  toPage({ path: "/instances/terminal", query: { daemonId, instanceId } });
};

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  load();
  timer = setInterval(load, 15000);
});
onBeforeUnmount(() => timer && clearInterval(timer));
</script>

<template>
  <div style="height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="height: 100%">
      <a-col :span="24">
        <BetweenMenus>
          <template v-if="!isPhone && !embeddedInManageModal" #left>
            <a-typography-title class="mb-0" :level="4">
              <TeamOutlined /> {{ card.title }}
            </a-typography-title>
          </template>
          <template #right>
            <a-button v-if="!embeddedInManageModal" @click="toConsole">
              <template #icon><RollbackOutlined /></template>
              {{ t("TXT_CODE_backup_to_console") }}
            </a-button>
            <a-button @click="load">{{ t("TXT_CODE_b76d94e0") }}</a-button>
          </template>
        </BetweenMenus>
      </a-col>

      <a-col :span="24">
        <a-alert
          v-if="!data.running"
          type="info"
          show-icon
          :message="t('TXT_CODE_bedrock_offline')"
        />
      </a-col>

      <!-- Online -->
      <a-col :xs="24" :lg="14">
        <CardPanel style="height: 100%">
          <template #title>{{ t("TXT_CODE_player_online") }} ({{ data.online.length }})</template>
          <template #body>
            <a-spin :spinning="loading">
              <a-empty v-if="!data.online.length" :description="t('TXT_CODE_player_none_online')" />
              <div v-for="name in data.online" :key="name" class="player-row">
                <UserOutlined class="player-head" />
                <span class="player-name">{{ name }}</span>
                <span class="player-actions">
                  <a-button
                    size="small"
                    @click="confirmAct('op', name, t('TXT_CODE_player_op'))"
                  >
                    {{ t("TXT_CODE_player_op") }}
                  </a-button>
                  <a-button
                    size="small"
                    @click="confirmAct('deop', name, t('TXT_CODE_player_deop'))"
                  >
                    {{ t("TXT_CODE_player_deop") }}
                  </a-button>
                  <a-button size="small" @click="confirmAct('kick', name, t('TXT_CODE_player_kick'))">
                    {{ t("TXT_CODE_player_kick") }}
                  </a-button>
                  <a-button
                    v-if="!isOnAllowlist(name)"
                    size="small"
                    @click="act('allowlist_add', name)"
                  >
                    {{ t("TXT_CODE_bedrock_allowlist_add") }}
                  </a-button>
                </span>
              </div>
            </a-spin>
          </template>
        </CardPanel>
      </a-col>

      <!-- Allowlist -->
      <a-col :xs="24" :lg="10">
        <CardPanel style="height: 100%">
          <template #title>
            {{ t("TXT_CODE_bedrock_allowlist") }} ({{ data.allowlist.length }})
          </template>
          <template #rightExtra>
            <a-switch
              :checked="data.allowlistEnabled"
              :checked-children="t('TXT_CODE_bedrock_allowlist_enforced')"
              @change="(c: boolean) => onToggleAllowlist(c)"
            />
          </template>
          <template #body>
            <div class="add-row">
              <a-input
                v-model:value="newName"
                :placeholder="t('TXT_CODE_bedrock_add_placeholder')"
                @press-enter="onAddAllowlist"
              />
              <a-button type="primary" @click="onAddAllowlist">
                {{ t("TXT_CODE_bedrock_add_btn") }}
              </a-button>
            </div>
            <a-empty
              v-if="!data.allowlist.length"
              :description="t('TXT_CODE_bedrock_allowlist_empty')"
            />
            <div v-for="entry in data.allowlist" :key="entry.name" class="player-row">
              <UserOutlined class="player-head" />
              <span class="player-name">
                {{ entry.name }}
                <a-tag
                  v-if="entry.xuid && data.operators.some((o) => o.xuid === entry.xuid)"
                  color="gold"
                  >OP</a-tag
                >
              </span>
              <span class="player-actions">
                <a-button
                  size="small"
                  danger
                  @click="confirmAct('allowlist_remove', entry.name, t('TXT_CODE_bedrock_allowlist_remove'))"
                >
                  {{ t("TXT_CODE_bedrock_allowlist_remove") }}
                </a-button>
              </span>
            </div>
          </template>
        </CardPanel>
      </a-col>
    </a-row>
  </div>
</template>

<style lang="scss" scoped>
.player-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}
.player-head {
  width: 40px;
  height: 40px;
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.12);
  flex-shrink: 0;
}
.player-name {
  flex: 1;
  font-weight: 500;
}
.player-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
</style>
```

- [ ] **Step 2: Verify the frontend type-checks**

Run: `npm run type-check --prefix frontend`
Expected: no errors.

If `CardPanel` does not support a `#rightExtra` slot, check `frontend/src/components/CardPanel.vue` for the actual title-extra slot name and use it; if there is none, move the allowlist `<a-switch>` to the top of the `#body` instead (above the add-row).

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/widgets/instance/BedrockPlayers.vue
git commit -m "feat(frontend): BedrockPlayers card (online/kick, allowlist, operators)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Make Players.vue edition-aware

**Files:**
- Modify: `frontend/src/widgets/instance/Players.vue`

- [ ] **Step 1: Import the hook + the Bedrock card and compute the edition**

In the `<script setup>` block of `frontend/src/widgets/instance/Players.vue`, add these imports and the `isBedrock` computed. Add `computed` to the existing `vue` import, and add the new imports near the other component/hook imports:

```typescript
import { computed } from "vue";
import { useInstanceInfo } from "@/hooks/useInstance";
import BedrockPlayers from "./BedrockPlayers.vue";
```

Then, after `const daemonId = String(getMetaOrRouteValue("daemonId") ?? "");`, add:

```typescript
const { instanceInfo } = useInstanceInfo({ instanceId, daemonId, autoRefresh: false });
const isBedrock = computed(() =>
  String(instanceInfo.value?.config?.type || "").includes("bedrock")
);
```

> If `onMounted`/`onBeforeUnmount` already import from `vue`, just append `computed` to that import line rather than adding a duplicate import.

- [ ] **Step 2: Branch the template**

Wrap the existing template so the Bedrock card renders for Bedrock instances. Change the root of the `<template>` from:

```vue
<template>
  <div style="height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="height: 100%">
      <!-- ...existing Java markup... -->
    </a-row>
  </div>
</template>
```

to:

```vue
<template>
  <BedrockPlayers v-if="isBedrock" :card="card" />
  <div v-else style="height: 100%" class="container">
    <a-row :gutter="[24, 24]" style="height: 100%">
      <!-- ...existing Java markup unchanged... -->
    </a-row>
  </div>
</template>
```

Leave everything inside the `<a-row>` exactly as it is.

- [ ] **Step 3: Verify the frontend type-checks**

Run: `npm run type-check --prefix frontend`
Expected: no errors.

Confirm the `useInstanceInfo` signature matches usage in `frontend/src/widgets/instance/ModManager.vue` (it is called there as `useInstanceInfo({ instanceId, daemonId, autoRefresh: true })`). Match the destructured property name it returns for the instance object (`instanceInfo`).

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/widgets/instance/Players.vue
git commit -m "feat(frontend): Players card renders BedrockPlayers for Bedrock instances" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full build gate + manual Test-stack verification

**Files:** none (verification only)

- [ ] **Step 1: Full local build/type-check**

Run all three and confirm each is clean:

```powershell
npm run build --prefix daemon
npm run build --prefix panel
npm run type-check --prefix frontend
```

Expected: no errors from any.

- [ ] **Step 2: Provide the rebuild block to the user**

Both images changed (daemon: new service + router; web: frontend + panel + languages). Hand the user the FULL copy-paste Unraid rebuild block (cd + git pull + both `docker build` + `docker rm -f` + BOTH `docker run` commands incl. the daemon `/mnt/user/Backup/Minecraft` mount + `docker ps | grep nexcraft`), per CLAUDE.md. Say both `nexcraft-daemon` and `nexcraft-web` changed.

- [ ] **Step 3: Manual verification checklist (Test stack, real Bedrock instance)**

Confirm on a running Bedrock instance:
- Manage → **Players** opens the Bedrock card (NOT the RCON message).
- **Online list** shows joined players; **Kick** removes one.
- **Allowlist**: add a gamertag (appears in roster + `allowlist.json`); remove it; toggle **Enforce allowlist** on/off (reflected in `server.properties` `allow-list` and the switch state after refresh).
- **Op/Deop** a player; operator tag appears on the allowlist entry (when the player is allowlisted, so the XUID resolves to a name).
- Stop the server: roster, operators, and the toggle still display; the online list is empty; a kick/allowlist action shows the "server must be running" error.
- A Java instance's Players card is unchanged.

- [ ] **Step 4: (After user confirms) update project memory**

Mark the Bedrock player-management feature done in `nexcraft-project.md` (remove parked todo #2), and note it's pending the Test-stack pass / `test`→`main` promotion.

---

## Self-Review

**Spec coverage:**
- Console-driven service (runConsole, list/kick/allowlist/op) → Task 1. ✓
- Overview shape + offline disk reads → Task 1 (`getBedrockOverview`, file readers). ✓
- Daemon events `player/bedrock_overview` + `player/bedrock_action` → Task 2. ✓
- Panel `/bedrock_overview` + `/bedrock_action` (ROLE.USER + ownership) → Task 3. ✓
- Frontend API + types → Task 4. ✓
- `BedrockPlayers.vue` (online/kick, allowlist add/remove/toggle, operators, no skin heads, 15s poll, embedded-modal hiding) → Task 5. ✓
- Edition-aware `Players.vue`, single grid button (ManagerBtns untouched) → Task 6. ✓
- Validation/injection guard, name quoting → Task 1 (`assertValidName`). ✓
- Bans intentionally excluded → no task (correct). ✓
- Testing = build/type-check + manual (no test runner) → Task 7 + note. ✓

**Placeholder scan:** No TBD/TODO; all code blocks are complete; the two "if the API differs, check X" notes point at concrete files (`CardPanel.vue`, `useInstance.ts`, `mc_motd.ts`) for verification, not unfinished work.

**Type consistency:** `BedrockPlayerAction`/`BedrockActionType` action strings match across daemon (Task 1/2), panel passthrough (Task 3), and frontend (Tasks 4–5). `BedrockPlayerOverview` fields (`running/online/allowlist/allowlistEnabled/operators`) are identical in daemon (Task 1) and frontend (Task 4) and consumed consistently in Task 5. i18n keys added in Task 4 are exactly those referenced in Task 5.
