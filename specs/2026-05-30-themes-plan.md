# Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-user selectable themes — each a full palette (accent + header/sidebar gradient over a stone texture + light/dark base) — saved to the account and chosen from the Profile dialog.

**Architecture:** A frontend theme registry drives CSS custom properties (`--nx-header-grad`, `--nx-sidebar-grad`, `--nx-accent`) + the Ant accent token + light/dark algorithm. The header and sidebar read those vars layered over a generated stone tile. The chosen theme id is stored on the user record (panel, like `avatar`) with a localStorage mirror for instant first-paint apply.

**Tech Stack:** Koa + TypeScript (panel/daemon, webpack), Vue 3 + Ant Design Vue 4 + vue-i18n (frontend, vue-tsc + vite), sharp (one-time tile generation).

**Verification methodology:** Build + type-check is the gate (no unit-test runner). Each task ends by building the affected package(s) and committing.

**CRITICAL — repo location:** The ONLY correct repo is `D:\NexCraft`. A stale decoy clone exists at `C:\Users\dimit\OneDrive\Documents\MCS` (the shell's default CWD) — never touch it. Use ABSOLUTE `D:\NexCraft\...` paths for Read/Edit/Write and `Set-Location D:\NexCraft` for every command.

PATH prefix for every PowerShell command:
```
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft;
```
Builds: `npm run build --prefix daemon` · `npm run build --prefix panel` · `npm run type-check --prefix frontend` · `npm run build --prefix frontend`.

---

## File Structure

Backend (panel):
- `entity/user.ts`, `entity/entity_interface.ts` — add `theme`.
- `service/user_service.ts` — persist `theme` + `isValidThemeId` + `THEME_IDS`.
- `service/instance_service.ts` — include `theme` in self-info.
- `routers/general_user_router.ts` — `PUT /auth/theme`.
- `routers/user_overview_router.ts` — accept `theme` on admin edit.

Frontend:
- `config/themes.ts` (new) — `ThemeDef`, `THEMES`, `DEFAULT_THEME_ID`, `themeById`.
- `assets/stone-tile.png` (new, generated).
- `stores/useAppConfigStore.ts` — `applyTheme`, `currentThemeId`, `setThemeId`, theme-driven base.
- `components/AppHeader.vue` — stone texture + `var(--nx-header-grad)`.
- `components/AppSidebarMenu.vue` — stone texture + `var(--nx-sidebar-grad)`.
- `components/MyselfInfoDialog.vue` — theme picker grid.
- `hooks/useHeaderMenus.ts` — remove the light/dark menu entry.
- `services/apis/user.ts` — `updateMyTheme`.
- `types/user.ts` — `theme?` on `BaseUserInfo`.
- `stores/useAppStateStore.ts` — apply theme from `userInfo.theme`.
- `languages/en_US.json` — theme i18n keys.

Daemon: none.

---

## Task 1: Backend — `theme` field, persistence, validation

**Files:** `panel/src/app/entity/entity_interface.ts`, `panel/src/app/entity/user.ts`, `panel/src/app/service/user_service.ts`

- [ ] **Step 1: Add `theme` to `IUser`**

In `D:\NexCraft\panel\src\app\entity\entity_interface.ts`, in `interface IUser`, after `avatar?: string;`:
```ts
  avatar?: string;
  theme?: string;
```

- [ ] **Step 2: Add `theme` to the `User` class**

In `D:\NexCraft\panel\src\app\entity\user.ts`, in `class User`, after `avatar: string = "";`:
```ts
  avatar: string = "";
  theme: string = "";
```

- [ ] **Step 3: Add the theme id list + validator + persist in `edit()`**

In `D:\NexCraft\panel\src\app\service\user_service.ts`, near the top (after the avatar helper added earlier), add:
```ts
// Known theme ids — kept in sync with the frontend registry
// (frontend/src/config/themes.ts). The panel can't import frontend code, so
// this list is duplicated intentionally; update both when adding a theme.
const THEME_IDS = ["nexcraft", "crafty", "nether", "emerald", "amethyst", "diamond"];
export function isValidThemeId(id: string): boolean {
  return THEME_IDS.includes(id);
}
```
In `edit(uuid, config)`, after the `avatar` branch:
```ts
    if (config.theme != null) {
      const t = String(config.theme);
      if (t === "" || isValidThemeId(t)) instance.theme = t;
    }
```

- [ ] **Step 4: Build the panel**

Run: `npm run build --prefix panel` → expect `compiled successfully`.

- [ ] **Step 5: Commit**

```
git add panel/src/app/entity/entity_interface.ts panel/src/app/entity/user.ts panel/src/app/service/user_service.ts; git commit -m "feat(theme): user theme field + validation/persistence" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend — expose theme in self-info; accept on update

**Files:** `panel/src/app/service/instance_service.ts`, `panel/src/app/routers/general_user_router.ts`, `panel/src/app/routers/user_overview_router.ts`

- [ ] **Step 1: Include `theme` in self-info**

In `D:\NexCraft\panel\src\app\service\instance_service.ts`, in `getInstancesByUuid`'s final `return { ... }`, after `avatar: user.avatar,`:
```ts
    avatar: user.avatar,
    theme: user.theme,
```

- [ ] **Step 2: Self theme endpoint**

In `D:\NexCraft\panel\src\app\routers\general_user_router.ts`, add the import alongside the avatar one:
```ts
import { validateAvatarString, isValidThemeId } from "../service/user_service";
```
(If `validateAvatarString` is already imported, just add `isValidThemeId` to that import.)
Add a route after the `PUT /avatar` handler:
```ts
// [Low-level Permission]
// Update only the current user's theme
router.put(
  "/theme",
  permission({ level: ROLE.USER }),
  validator({ body: { theme: String } }),
  async (ctx: Koa.ParameterizedContext) => {
    const userUuid = getUserUuid(ctx);
    if (!userUuid) return;
    const theme = String(ctx.request.body.theme ?? "");
    if (theme !== "" && !isValidThemeId(theme)) throw new Error("Invalid theme id");
    await userSystem.edit(userUuid, { theme });
    ctx.body = true;
  }
);
```

- [ ] **Step 3: Admin edit accepts theme**

In `D:\NexCraft\panel\src\app\routers\user_overview_router.ts`, the admin `PUT /` handler passes `config` to `userSystem.edit` (which already validates `theme` from Task 1). No change strictly required — `edit()` validates. Confirm by reading; if the handler whitelists fields explicitly, add `theme`. (As of now `edit(uuid, config)` copies known fields, so no change needed.)

- [ ] **Step 4: Build the panel**

Run: `npm run build --prefix panel` → expect `compiled successfully`.

- [ ] **Step 5: Commit**

```
git add panel/src/app/service/instance_service.ts panel/src/app/routers/general_user_router.ts; git commit -m "feat(theme): expose theme in self-info; PUT /auth/theme" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Generate the stone tile asset

**Files:** `frontend/src/assets/stone-tile.png` (new)

- [ ] **Step 1: Write the generator script (temp)**

Create `D:\NexCraft\scripts\gen-stone-tile.cjs`:
```js
// One-time generator for the seamless stone texture used by the header/sidebar.
// Run: node scripts/gen-stone-tile.cjs  (requires sharp; dev-only, not shipped)
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const N = 8; // 8x8 cells
const CELL = 16; // px per cell -> 128px tile
const SIZE = N * CELL;
// Deterministic value-noise grayscale, wrapped so edges tile seamlessly.
let s = 1234567;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const grid = Array.from({ length: N }, () => Array.from({ length: N }, () => Math.round(120 + rnd() * 90)));
let rects = "";
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const g = grid[y][x];
    const px = x * CELL, py = y * CELL;
    const lite = Math.min(255, g + 26), dark = Math.max(0, g - 32);
    rects += `<rect x="${px}" y="${py}" width="${CELL}" height="${CELL}" fill="rgb(${g},${g},${g})"/>`;
    rects += `<rect x="${px}" y="${py}" width="${CELL}" height="2" fill="rgb(${lite},${lite},${lite})" opacity="0.5"/>`;
    rects += `<rect x="${px}" y="${py}" width="2" height="${CELL}" fill="rgb(${lite},${lite},${lite})" opacity="0.4"/>`;
    rects += `<rect x="${px}" y="${py + CELL - 2}" width="${CELL}" height="2" fill="rgb(${dark},${dark},${dark})" opacity="0.5"/>`;
    rects += `<rect x="${px + CELL - 2}" y="${py}" width="2" height="${CELL}" fill="rgb(${dark},${dark},${dark})" opacity="0.4"/>`;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${rects}</svg>`;
const out = path.join(__dirname, "..", "frontend", "src", "assets", "stone-tile.png");
sharp(Buffer.from(svg)).png().toFile(out).then((i) => console.log("wrote", out, i.width + "x" + i.height));
```

- [ ] **Step 2: Run it (sharp is available globally in the temp dir used earlier; install locally if missing)**

Run:
```
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft; if (-not (Test-Path node_modules\sharp)) { npm install --no-save sharp }; node scripts/gen-stone-tile.cjs
```
Expected: `wrote ...stone-tile.png 128x128`. Confirm the PNG exists: `Test-Path frontend\src\assets\stone-tile.png` → True.

- [ ] **Step 3: Commit the asset (and the generator)**

```
git add frontend/src/assets/stone-tile.png scripts/gen-stone-tile.cjs; git commit -m "feat(theme): generated seamless stone texture tile" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(If `npm install --no-save sharp` modified package-lock, do NOT commit that — `--no-save` shouldn't. Verify `git status` only shows the two intended files before committing.)

---

## Task 4: Frontend — theme registry + i18n + types

**Files:** `frontend/src/config/themes.ts` (new), `frontend/src/types/user.ts`, `languages/en_US.json`

- [ ] **Step 1: Create the registry**

Create `D:\NexCraft\frontend\src\config\themes.ts`:
```ts
export interface ThemeDef {
  id: string;
  nameKey: string; // i18n key for the display name
  base: "light" | "dark";
  accent: string;
  headerGradient: string;
  sidebarGradient: string;
}

export const THEMES: ThemeDef[] = [
  {
    id: "nexcraft",
    nameKey: "TXT_CODE_theme_name_nexcraft",
    base: "light",
    accent: "#3179bd",
    headerGradient: "linear-gradient(90deg, #162961 0%, #393f98 32%, #5c469c 58%, #1587ac 100%)",
    sidebarGradient: "linear-gradient(160deg, #162961 0%, #393f98 40%, #5c469c 65%, #1587ac 100%)"
  },
  {
    id: "crafty",
    nameKey: "TXT_CODE_theme_name_crafty",
    base: "dark",
    accent: "#20a4a4",
    headerGradient: "linear-gradient(90deg, #1b2240 0%, #20a4a4 45%, #6c4bd1 100%)",
    sidebarGradient: "linear-gradient(160deg, #161c33 0%, #1b2240 55%, #2a2150 100%)"
  },
  {
    id: "nether",
    nameKey: "TXT_CODE_theme_name_nether",
    base: "dark",
    accent: "#e0552b",
    headerGradient: "linear-gradient(90deg, #3a0d0d 0%, #7a1f12 50%, #c0392b 100%)",
    sidebarGradient: "linear-gradient(160deg, #2a0a0a 0%, #4a1410 60%, #6e1f15 100%)"
  },
  {
    id: "emerald",
    nameKey: "TXT_CODE_theme_name_emerald",
    base: "light",
    accent: "#2f9e44",
    headerGradient: "linear-gradient(90deg, #0b3d1f 0%, #1a7a3c 50%, #37b24d 100%)",
    sidebarGradient: "linear-gradient(160deg, #0b3d1f 0%, #155c30 60%, #1f7a3f 100%)"
  },
  {
    id: "amethyst",
    nameKey: "TXT_CODE_theme_name_amethyst",
    base: "dark",
    accent: "#9c6cf0",
    headerGradient: "linear-gradient(90deg, #2a1a4a 0%, #5e3bb0 50%, #9c6cf0 100%)",
    sidebarGradient: "linear-gradient(160deg, #1f1438 0%, #3a2470 60%, #5a3aa0 100%)"
  },
  {
    id: "diamond",
    nameKey: "TXT_CODE_theme_name_diamond",
    base: "light",
    accent: "#1aa3c4",
    headerGradient: "linear-gradient(90deg, #0a3a4a 0%, #1488a8 50%, #3fd0e8 100%)",
    sidebarGradient: "linear-gradient(160deg, #0a3a4a 0%, #10657f 60%, #1a8aa8 100%)"
  }
];

export const DEFAULT_THEME_ID = "nexcraft";
export const THEME_ID_KEY = "nx-theme-id";
export const themeById = (id?: string): ThemeDef =>
  THEMES.find((t) => t.id === id) || THEMES[0];
```

- [ ] **Step 2: i18n keys**

In `D:\NexCraft\languages\en_US.json` add:
```json
  "TXT_CODE_theme_label": "Theme",
  "TXT_CODE_theme_name_nexcraft": "NexCraft",
  "TXT_CODE_theme_name_crafty": "Crafty",
  "TXT_CODE_theme_name_nether": "Nether",
  "TXT_CODE_theme_name_emerald": "Emerald",
  "TXT_CODE_theme_name_amethyst": "Amethyst",
  "TXT_CODE_theme_name_diamond": "Diamond",
```

- [ ] **Step 3: `theme?` on `BaseUserInfo`**

In `D:\NexCraft\frontend\src\types\user.ts`, in `interface BaseUserInfo`, after `avatar?: string;`:
```ts
  avatar?: string;
  theme?: string;
```

- [ ] **Step 4: Verify + commit**

Run `node -e "JSON.parse(require('fs').readFileSync('languages/en_US.json','utf8'));console.log('JSON OK')"` then `npm run type-check --prefix frontend`. Expect JSON OK + clean.
```
git add frontend/src/config/themes.ts frontend/src/types/user.ts languages/en_US.json; git commit -m "feat(theme): theme registry, types, and i18n keys" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — apply themes in the config store

**Files:** `frontend/src/stores/useAppConfigStore.ts`

Goal: add theme-id machinery that drives accent + CSS gradient vars + light/dark base, while keeping `isDarkTheme`/`setBackgroundImage`/`initAppTheme` working. Read the whole file first.

- [ ] **Step 1: Imports + state**

At the top of `D:\NexCraft\frontend\src\stores\useAppConfigStore.ts`, add:
```ts
import { THEMES, DEFAULT_THEME_ID, THEME_ID_KEY, themeById, type ThemeDef } from "@/config/themes";
```
Inside the store, add a current-theme-id (localStorage mirror) and an active-base ref. Replace the existing `const currentTheme = useLocalStorage<AppTheme>(THEME_KEY, AppTheme.LIGHT);` line with:
```ts
  const currentThemeId = useLocalStorage<string>(THEME_ID_KEY, DEFAULT_THEME_ID);
  const activeBase = ref<"light" | "dark">("light");
```

- [ ] **Step 2: Rewrite `isDarkTheme` to read the active base**

Replace the existing `isDarkTheme` computed with:
```ts
  const isDarkTheme = computed(() => activeBase.value === "dark");
```

- [ ] **Step 3: Add `applyTheme` + `setThemeId`; rewrite `initAppTheme`**

Add:
```ts
  const applyTheme = (themeDef: ThemeDef) => {
    const body = document.body;
    body.style.setProperty("--nx-header-grad", themeDef.headerGradient);
    body.style.setProperty("--nx-sidebar-grad", themeDef.sidebarGradient);
    body.style.setProperty("--nx-accent", themeDef.accent);
    theme.token!.colorPrimary = themeDef.accent;
    theme.token!.colorLink = themeDef.accent;
    activeBase.value = themeDef.base;
    if (themeDef.base === "dark") setDark();
    else setLight();
  };

  const setThemeId = (id?: string) => {
    const def = themeById(id);
    currentThemeId.value = def.id;
    applyTheme(def);
  };
```
Replace the body of `initAppTheme` (keep its name + the sidebarPosition logic at the end) so it applies the stored theme id instead of the old AppTheme switch:
```ts
  const initAppTheme = async () => {
    setThemeId(currentThemeId.value);

    const frontendSettings = await getSettingsConfig();
    if (frontendSettings?.theme?.backgroundImage)
      setBackgroundImage(frontendSettings.theme.backgroundImage);
    const pos = frontendSettings?.theme?.sidebarPosition;
    sidebarPosition.value = pos === "left" || pos === "right" ? pos : "left";
  };
```
Remove the now-unused `resetTheme` and the old `setTheme`/`currentTheme` and the `watch(isPreferredDark, ...)` block (themes carry an explicit base; no auto-follow). Remove the `AppTheme` import if it's now unused. Keep `setLight`/`setDark`.

- [ ] **Step 4: Update the store's return object**

In the returned object, replace `setTheme`, `currentTheme` with `setThemeId`, `currentThemeId`, and add `applyTheme`. Keep `initAppTheme`, `isDarkTheme`, `setBackgroundImage`, `themeConfig`, etc.

- [ ] **Step 5: Type-check + build**

Run `npm run type-check --prefix frontend`. If it reports `setTheme`/`currentTheme` referenced elsewhere, those callers are updated in Tasks 6–7 — so this task's type-check may fail ONLY on `useHeaderMenus.ts`/`useAppStateStore.ts` references. If so, that's expected; note it and proceed (the build goes green after Task 7). If other unrelated errors appear, fix them. Then `npm run build --prefix frontend` may fail for the same reason — acceptable until Task 7.

- [ ] **Step 6: Commit**

```
git add frontend/src/stores/useAppConfigStore.ts; git commit -m "feat(theme): apply themes via CSS vars + accent token + base" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — header + sidebar read theme vars over the stone tile

**Files:** `frontend/src/components/AppHeader.vue`, `frontend/src/components/AppSidebarMenu.vue`

- [ ] **Step 1: Header texture + gradient**

In `D:\NexCraft\frontend\src\components\AppHeader.vue` `<style>`, the `.app-header-wrapper` currently sets `background-image: linear-gradient(90deg, #162961 ... #1587ac 100%);`. Replace that hardcoded gradient with a stacked texture + theme gradient. Change the rule to:
```scss
.app-header-wrapper {
  box-shadow: 0 2px 4px 0 var(--card-shadow-color);
  background-color: #182142;
  background-image: var(--nx-header-grad), url("@/assets/stone-tile.png");
  background-blend-mode: overlay, normal;
  background-repeat: repeat;
  ...
}
```
(Keep all the other existing properties in that rule — width/display/position/etc. Only the `background-image` line changes, plus adding `background-blend-mode` and `background-repeat`. The gradient must be the FIRST background layer so it blends over the texture.)

- [ ] **Step 2: Sidebar texture + gradient**

In `D:\NexCraft\frontend\src\components\AppSidebarMenu.vue` `<style>`, the `.left-sidebar` rule has a hardcoded `linear-gradient(...) , url("@/assets/side.png")`. Replace the `background-image` with:
```scss
  background-image: var(--nx-sidebar-grad), url("@/assets/stone-tile.png");
  background-blend-mode: overlay, normal;
  background-repeat: repeat;
```
(Keep `background-color`, padding, transition, etc. Remove only the old hardcoded gradient + `side.png`.)

- [ ] **Step 2b: Initialize the CSS vars before first paint**

Because `initAppTheme()` runs in `App.vue` `onBeforeMount`/`onMounted`, the vars are set early. No further change needed; if the header flashes un-themed, that's covered because `initAppTheme` runs before the header mounts. (No code change in this step — verification note only.)

- [ ] **Step 3: Type-check + build**

Run `npm run type-check --prefix frontend` then `npm run build --prefix frontend`. Same caveat as Task 5: may still fail on the `useHeaderMenus.ts` `setTheme` reference until Task 7. If so, proceed.

- [ ] **Step 4: Commit**

```
git add frontend/src/components/AppHeader.vue frontend/src/components/AppSidebarMenu.vue; git commit -m "feat(theme): header + sidebar use theme gradient vars over stone tile" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Frontend — remove light/dark menu, apply theme on login

**Files:** `frontend/src/hooks/useHeaderMenus.ts`, `frontend/src/stores/useAppStateStore.ts`

- [ ] **Step 1: Remove the header light/dark dropdown entry**

In `D:\NexCraft\frontend\src\hooks\useHeaderMenus.ts`, remove the `setTheme` import usage and the whole `appMenus` entry that uses `BgColorsOutlined` (the one with `title: t("TXT_CODE_5d88a9b")`, `leftSideTitle: t("TXT_CODE_ee01c10c")`, `icon: BgColorsOutlined`, and the AUTO/LIGHT/DARK `menus`). Also remove `const { setTheme } = useAppConfigStore();` (and the `useAppConfigStore` import if now unused), and remove the `BgColorsOutlined` and `AppTheme` imports if now unused.

- [ ] **Step 2: Apply theme when user info loads**

In `D:\NexCraft\frontend\src\stores\useAppStateStore.ts`, import the config store applier. At the top add:
```ts
import { useAppConfigStore } from "./useAppConfigStore";
```
In `updateUserInfo`, after `state.userInfo = userInfo;` AND after the `else` branch sets `state.userInfo = info.value;`, apply the theme. Simplest: after the try/catch assignment, add a single application using the resolved user info:
```ts
  const updateUserInfo = async (userInfo?: LoginUserInfo) => {
    try {
      if (userInfo) {
        state.userInfo = userInfo;
      } else {
        const info = await reqUserInfo();
        if (info.value) {
          state.userInfo = info.value;
        } else {
          throw new Error("Failed to get user information from server!");
        }
      }
      const { setThemeId } = useAppConfigStore();
      if (state.userInfo?.theme) setThemeId(state.userInfo.theme);
    } catch (err: any) {
      console.error(err);
      throw new Error(err.message);
    }
  };
```

- [ ] **Step 3: Type-check + build (must be green now)**

Run `npm run type-check --prefix frontend` then `npm run build --prefix frontend`. Both MUST pass now. Fix any remaining `setTheme`/`currentTheme`/`AppTheme` references the compiler reports (search the frontend: `grep -rn "setTheme\|currentTheme\b" frontend/src` — none should remain except `currentThemeId`).

- [ ] **Step 4: Commit**

```
git add frontend/src/hooks/useHeaderMenus.ts frontend/src/stores/useAppStateStore.ts; git commit -m "feat(theme): drop light/dark toggle; apply user theme on login" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Frontend — theme picker in the Profile dialog + API

**Files:** `frontend/src/services/apis/user.ts`, `frontend/src/components/MyselfInfoDialog.vue`

- [ ] **Step 1: API**

In `D:\NexCraft\frontend\src\services\apis\user.ts`, append:
```ts
export const updateMyTheme = useDefineApi<
  {
    data: {
      theme: string;
    };
  },
  boolean
>({
  url: "/api/auth/theme",
  method: "PUT"
});
```

- [ ] **Step 2: Picker logic in the dialog**

In `D:\NexCraft\frontend\src\components\MyselfInfoDialog.vue` `<script setup>`, add imports:
```ts
import { THEMES } from "@/config/themes";
import { updateMyTheme } from "@/services/apis/user";
import { useAppConfigStore } from "@/stores/useAppConfigStore";
```
Add (near the other handlers; `state`, `updateUserInfo`, `message`, `t`, `reportErrorMsg` are already in scope; `ref` is already imported):
```ts
const { currentThemeId, setThemeId } = useAppConfigStore();
const themeSaving = ref(false);

const chooseTheme = async (id: string) => {
  setThemeId(id); // live preview + localStorage mirror
  try {
    themeSaving.value = true;
    await updateMyTheme().execute({ data: { theme: id } });
    await updateUserInfo();
    message.success(t("TXT_CODE_d3de39b4"));
  } catch (error: any) {
    reportErrorMsg(error.message);
  } finally {
    themeSaving.value = false;
  }
};
```

- [ ] **Step 3: Picker UI**

In the template, add a Theme section right after the avatar `<a-form-item>` (before the username row):
```vue
        <a-form-item :label="t('TXT_CODE_theme_label')">
          <div class="theme-grid">
            <div
              v-for="th in THEMES"
              :key="th.id"
              class="theme-swatch"
              :class="{ 'theme-swatch-active': currentThemeId === th.id }"
              @click="chooseTheme(th.id)"
            >
              <span class="theme-bar" :style="{ backgroundImage: th.headerGradient }"></span>
              <span class="theme-dot" :style="{ backgroundColor: th.accent }"></span>
              <span class="theme-name">{{ t(th.nameKey) }}</span>
            </div>
          </div>
        </a-form-item>
```
Add to the component `<style scoped>` (create a `<style scoped>` block if none exists):
```scss
.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.theme-swatch {
  border: 2px solid var(--color-gray-5, #d9d9d9);
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: border-color 0.2s;
}
.theme-swatch:hover { border-color: var(--nx-accent, #3179bd); }
.theme-swatch-active { border-color: var(--nx-accent, #3179bd); }
.theme-bar { height: 22px; border-radius: 4px; display: block; }
.theme-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
.theme-name { font-size: 12px; }
```

- [ ] **Step 4: Type-check + build**

Run `npm run type-check --prefix frontend` then `npm run build --prefix frontend`. Both green.

- [ ] **Step 5: Commit**

```
git add frontend/src/services/apis/user.ts frontend/src/components/MyselfInfoDialog.vue; git commit -m "feat(theme): theme picker in the profile dialog" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Final verification + push

- [ ] **Step 1: Build everything**

Run:
```
npm run build --prefix daemon; npm run build --prefix panel; npm run type-check --prefix frontend; npm run build --prefix frontend
```
Expected: all succeed.

- [ ] **Step 2: Confirm no stale references**

Run: `git -C D:\NexCraft grep -n "AppTheme\|setTheme(" -- frontend/src` — should return nothing in changed code paths (only the `AppTheme` enum definition in `types/const.ts` may remain, unused, which is fine; optionally delete it if no references remain).

- [ ] **Step 3: Push**

```
git push nexcraft main
```

- [ ] **Step 4: Manual verification (after rebuilding + updating the web image)**

1. Profile → Theme grid shows 6 swatches; current marked.
2. Click a theme → accent (buttons/links), header + sidebar gradient (stone visible beneath), and light/dark base all update live; reload persists; logging in on another browser shows the same theme.
3. Stone texture shows under header + sidebar in every theme.
4. Login page applies the last-used theme before auth (localStorage mirror).
5. No leftover light/dark/auto toggle in the header.

---

## Self-Review Notes

- **Spec coverage:** registry (T4) · apply via CSS vars + accent + base (T5) · header/sidebar over stone tile (T6) · generated tile (T3) · server-side storage like avatar (T1–T2) · localStorage mirror + apply on login (T5 init + T7) · picker in Profile (T8) · drop light/dark toggle (T7) · i18n (T4). All covered.
- **Type consistency:** `setThemeId`/`currentThemeId`/`applyTheme`/`themeById`/`THEMES`/`ThemeDef`/`THEME_ID_KEY`/`DEFAULT_THEME_ID` used consistently across T4–T8; backend `isValidThemeId`/`THEME_IDS`/`theme` field consistent T1–T2; `updateMyTheme` returns boolean.
- **Ordering caveat documented:** T5/T6 may not type-check green in isolation because `useHeaderMenus.ts` still references `setTheme` until T7 removes it — called out in those tasks; the suite is green by end of T7.
- **No placeholders:** every code step shows the actual code.
