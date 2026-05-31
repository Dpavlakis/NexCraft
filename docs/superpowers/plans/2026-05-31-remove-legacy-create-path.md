# Remove Legacy Manual-Create Subsystem (#18) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make instance creation Minecraft-centric by removing the legacy "Create Directly" manual form and the entire `/quickstart` wizard subsystem, leaving the modpack browser (Vanilla/Java builder + CurseForge + Modrinth + Import) as the single create path.

**Architecture:** Pure removal. Delete three wizard Vue components + their routes/default-pages/card-registrations, gut the shared `quickStartFlow.ts` down to just the two enums that surviving code still imports, and drop the one "Create Directly" link in the modpack browser. The Import flow (`CreateInstanceForm` in IMPORT mode) is untouched.

**Tech Stack:** Vue 3 + TypeScript (frontend), Koa (panel — only `frontend_layout.ts` defaults), webpack/vue-tsc builds.

---

## ⚠️ Project conventions (override the writing-plans TDD default)
- **No unit-test runner exists.** Per CLAUDE.md the gate is **type-check / build** (`npm run type-check --prefix frontend`, `npm run build --prefix panel`) + manual check on the Test stack. Do NOT add a test framework. Each task's verification = a clean build.
- **PowerShell PATH prefix (run before EVERY npm command):**
  ```powershell
  $env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
  ```
- **Branch:** `test` (already checked out — do NOT create a branch).
- **Commit messages end with:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Spec: `docs/superpowers/specs/2026-05-31-remove-legacy-create-path-design.md`.

## File map
- Modify: `frontend/src/widgets/market/ModpackBrowser.vue` (remove "Create Directly" link + its orphaned CSS)
- Delete: `frontend/src/widgets/QuickStart.vue`
- Delete: `frontend/src/widgets/setupApp/QuickStartFlow.vue`
- Delete: `frontend/src/widgets/setupApp/McPreset.vue`
- Modify: `frontend/src/hooks/widgets/quickStartFlow.ts` (gut to 2 enums)
- Modify: `frontend/src/config/index.ts` (remove 3 imports, 3 map entries, 1 pool entry)
- Modify: `frontend/src/config/router.ts` (remove `/quickstart` route block)
- Modify: `panel/src/app/service/frontend_layout.ts` (remove 2 default-page blocks)
- Modify: `languages/en_US.json` (prune zero-reference orphaned keys — conservative)

---

## Task 1: Remove the "Create Directly" link from the modpack browser

**Files:**
- Modify: `frontend/src/widgets/market/ModpackBrowser.vue`

- [ ] **Step 1: Remove the link in the import panel**

Find this block (in the `<template>`, inside `class="import-panel"`, just after the "Import Compressed Package" button) and delete it:
```vue
              <a class="import-empty-link" @click="emit('manual-install', QUICKSTART_METHOD.EXIST)">
                {{ t("TXT_CODE_e0fca76") }}
              </a>
```
Leave the surrounding `<div class="import-panel">` and the "Import Compressed Package" `<a-button>` (which emits `QUICKSTART_METHOD.IMPORT`) intact.

- [ ] **Step 2: Remove the now-orphaned CSS**

In the `<style>` block, delete the `.import-empty-link` rule (the selector is `.import-panel .import-empty-link`, around line 1119). If it has hover/related sub-rules, remove those too. Do not touch other `.import-panel` styles.

- [ ] **Step 3: Confirm `QUICKSTART_METHOD` is still used**

The file still emits `QUICKSTART_METHOD.IMPORT`, so keep the `import { QUICKSTART_METHOD } from "@/hooks/widgets/quickStartFlow";` line. (Quick check: `grep -n "QUICKSTART_METHOD" frontend/src/widgets/market/ModpackBrowser.vue` should still show the import + the IMPORT emit, and NO `.EXIST`.)

- [ ] **Step 4: Type-check**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run type-check --prefix frontend
```
Expected: no errors.

- [ ] **Step 5: Commit**
```powershell
git add frontend/src/widgets/market/ModpackBrowser.vue
git commit -m @'
feat(#18): remove the "Create Directly" manual-create link from the Import tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 2: Delete the legacy `/quickstart` wizard subsystem

This task removes the three wizard components and every reference to them, and reduces `quickStartFlow.ts` to just the shared enums. Do ALL steps before the build — the build only goes green once every reference is gone.

**Files:**
- Delete: `frontend/src/widgets/QuickStart.vue`, `frontend/src/widgets/setupApp/QuickStartFlow.vue`, `frontend/src/widgets/setupApp/McPreset.vue`
- Modify: `frontend/src/config/index.ts`, `frontend/src/config/router.ts`, `frontend/src/hooks/widgets/quickStartFlow.ts`, `panel/src/app/service/frontend_layout.ts`

- [ ] **Step 1: Verify nothing outside config/index.ts imports the three components**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
```
Then (Grep tool, or `findstr`): search `frontend/src` for `QuickStart.vue`, `QuickStartFlow.vue`, `McPreset.vue`. Expected: only `frontend/src/config/index.ts` references them. If any OTHER file imports them, STOP and report (the plan assumed only config/index.ts does).

- [ ] **Step 2: Delete the three component files**
```powershell
Remove-Item frontend/src/widgets/QuickStart.vue
Remove-Item frontend/src/widgets/setupApp/QuickStartFlow.vue
Remove-Item frontend/src/widgets/setupApp/McPreset.vue
```

- [ ] **Step 3: Edit `frontend/src/config/index.ts` — remove the three imports**

Delete these three import lines:
```ts
import QuickStart from "@/widgets/QuickStart.vue";
import McPreset from "@/widgets/setupApp/McPreset.vue";
import QuickStartFlow from "@/widgets/setupApp/QuickStartFlow.vue";
```

- [ ] **Step 4: Edit `frontend/src/config/index.ts` — remove the three `LAYOUT_CARD_TYPES` map entries**

In the `LAYOUT_CARD_TYPES` object, delete the bare references `QuickStart,`, `QuickStartFlow,`, and `McPreset,` (each on its own line).

- [ ] **Step 5: Edit `frontend/src/config/index.ts` — remove the `QuickStart` card-pool entry**

Delete this whole object (including its trailing comma) from the card-pool array:
```ts
    {
      id: getRandomId(),
      permission: ROLE.ADMIN,
      type: "QuickStart",
      title: t("TXT_CODE_e01539f1"),
      meta: {},
      width: 4,
      description: t("TXT_CODE_d628e631"),
      height: LayoutCardHeight.MEDIUM,
      category: NEW_CARD_TYPE.INSTANCE
    },
```
(There is no `QuickStartFlow`/`McPreset` pool entry — they are only placed via the default pages removed in Step 8.)

- [ ] **Step 6: Edit `frontend/src/config/router.ts` — remove the `/quickstart` route block**

Delete this whole route object (parent + its `/quickstart/minecraft` child), including its trailing comma:
```ts
  {
    path: "/quickstart",
    name: t("TXT_CODE_2799a1dd"),
    component: LayoutContainer,
    meta: {
      permission: ROLE.ADMIN,
      mainMenu: false
    },
    children: [
      {
        path: "/quickstart/minecraft",
        name: t("TXT_CODE_88249aee"),
        component: LayoutContainer,
        meta: {
          permission: ROLE.ADMIN
        }
      }
    ]
  },
```

- [ ] **Step 7: Gut `frontend/src/hooks/widgets/quickStartFlow.ts` to just the two enums**

Replace the ENTIRE file contents with:
```ts
// Shared instance-creation enums. The legacy quick-start wizard that this file
// used to host was removed in #18; only these enums remain. They are imported by
// the modpack browser / Import flow (QUICKSTART_METHOD) and the command-assistant
// + start-command builder (QUICKSTART_ACTION_TYPE).

export enum QUICKSTART_ACTION_TYPE {
  Minecraft = "minecraft",
  Bedrock = "bedrock",
  Hytale = "hytale",
  Terraria = "terraria",
  SteamGameServer = "steam",
  Docker = "docker",
  AnyApp = "universal"
}

export enum QUICKSTART_METHOD {
  FAST = "FAST",
  FILE = "FILE",
  IMPORT = "IMPORT",
  SELECT = "SELECT",
  EXIST = "EXIST",
  DOCKER = "DOCKER"
}
```
(Keep all enum members even if some now look unused — they are referenced by `CreateInstanceForm.vue`'s `changeInstanceType` and prop typing; removing members risks breaking those references.)

- [ ] **Step 8: Edit `panel/src/app/service/frontend_layout.ts` — remove the two default-page blocks**

Delete the `page: "/quickstart"` block (the one whose `items` contains a single `type: "QuickStartFlow"` card) AND the `page: "/quickstart/minecraft"` block (the one whose `items` contain `type: "McPreset"` + an `EmptyCard`). Remove each whole object including its trailing comma. Leave all other pages intact.

- [ ] **Step 9: Build frontend + panel (the gate)**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run type-check --prefix frontend
npm run build --prefix panel
```
Expected: both clean. If vue-tsc reports an unresolved import or unknown name, it means a reference to a deleted file/export was missed — fix it (search for the symbol) and re-run. (`McPreset` may import an `AppPackages` component — that is NOT deleted here; leave it.)

- [ ] **Step 10: Commit**
```powershell
git add frontend/src/config/index.ts frontend/src/config/router.ts frontend/src/hooks/widgets/quickStartFlow.ts panel/src/app/service/frontend_layout.ts frontend/src/widgets/QuickStart.vue frontend/src/widgets/setupApp/QuickStartFlow.vue frontend/src/widgets/setupApp/McPreset.vue
git commit -m @'
feat(#18): retire the legacy /quickstart wizard subsystem (single create path = modpack browser)

Delete QuickStart card, QuickStartFlow wizard, and McPreset page; remove their routes,
default pages, and card registrations. Reduce quickStartFlow.ts to the two enums still
used by the Import flow and the command-assistant.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 3: Prune orphaned i18n keys (conservative — zero-reference only)

**Files:**
- Modify: `languages/en_US.json`

> Only remove keys that have NO remaining reference in code after Tasks 1–2. Some candidates are still used by the Import flow (e.g. `TXT_CODE_444db70f` is the FILE-upload label reused by `CreateInstanceForm.vue`) and MUST be kept. Orphaned keys are harmless, so when in doubt, leave it.

- [ ] **Step 1: Check each candidate key for remaining references**

Run this for the candidate list (PowerShell). It prints each key with its reference count across `frontend/` + `panel/` source (excluding the language JSON files):
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
$keys = @("TXT_CODE_e0fca76","TXT_CODE_e01539f1","TXT_CODE_d628e631","TXT_CODE_2799a1dd","TXT_CODE_88249aee","TXT_CODE_9b99b72e","TXT_CODE_724ce74d")
foreach ($k in $keys) {
  $n = (Get-ChildItem -Recurse frontend/src,panel/src -Include *.ts,*.vue | Select-String -SimpleMatch $k | Measure-Object).Count
  Write-Host "$k => $n refs"
}
```
A key showing `=> 0 refs` is orphaned and safe to remove. Any key with `>= 1 ref` MUST be kept.

- [ ] **Step 2: Remove the zero-reference keys from `languages/en_US.json`**

Use the Edit tool to delete each `"TXT_CODE_xxxx": "...",` line that Step 1 reported as `0 refs`. Edit ONLY `languages/en_US.json` (en_US is source of truth; other language files fall back). Do not remove any key that still has references.

- [ ] **Step 3: Validate JSON + type-check**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
node -e "JSON.parse(require('fs').readFileSync('languages/en_US.json','utf8')); console.log('en_US.json OK')"
npm run type-check --prefix frontend
```
Expected: `en_US.json OK` and a clean type-check.

- [ ] **Step 4: Commit**
```powershell
git add languages/en_US.json
git commit -m @'
chore(#18): prune orphaned quick-start i18n keys (zero-reference only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```
(If Step 1 found that ALL candidates still have references, skip Steps 2–4 and note "no orphaned keys to prune.")

---

## Task 4: Full build verification + push

**Files:** none (verification only)

- [ ] **Step 1: Full builds**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
npm run build --prefix panel
npm run build --prefix frontend
```
Expected: all three complete with no errors.

- [ ] **Step 2: Confirm no dangling references remain**

Search `frontend/src` + `panel/src` for: `QuickStart.vue`, `QuickStartFlow`, `McPreset`, `/quickstart`, `useQuickStartFlow`. Expected: zero matches (other than possibly a comment). If any remain, fix before proceeding.

- [ ] **Step 3: Push**
```powershell
git push origin test
```

- [ ] **Step 4: Hand off for manual verification on the Test stack**

This is web-only (frontend + panel default layout). Tell the user to rebuild the **`nexcraft-web`** `:test` image (run the Publish Docker workflow on `test`) and force-update `NexCraft-Web-Test`, then verify:
  1. The modpack browser still creates a **Java** instance (Vanilla/builder), a **Bedrock** instance, and a **CurseForge/Modrinth** modpack.
  2. The **Import / Existing** tab still imports a zip and **no longer shows a "Create Directly" link**.
  3. There is no reachable `/quickstart` page and no broken/empty card on any default page; no console errors about unknown card types.

---

## Self-Review

**Spec coverage:**
- Remove "Create Directly" link → Task 1. ✓
- Delete QuickStart.vue / QuickStartFlow.vue / McPreset.vue → Task 2 Steps 1-2. ✓
- Remove routes `/quickstart` (+child) → Task 2 Step 6. ✓
- Remove default pages → Task 2 Step 8. ✓
- Remove card registry imports/map/pool → Task 2 Steps 3-5. ✓
- Gut quickStartFlow.ts to the two enums → Task 2 Step 7. ✓
- Keep modpack browser / Import / CreateInstanceForm / useGenerateStartCmd / CmdAssistantDialog → not touched (verified by the "only config/index.ts imports" check in Task 2 Step 1, and the build gate). ✓
- Prune orphaned i18n (conservative) → Task 3. ✓
- Out-of-scope items (CreateInstanceForm dead-branch trim, Velocity, CmdAssistant Steam/Universal) → intentionally not in any task, matching the spec. ✓
- Verification (3 builds + manual checklist) → Task 4. ✓

**Placeholder scan:** No TBD/TODO; every edit gives the exact block to find/delete or the exact replacement content. Task 3 lists concrete candidate keys + a concrete reference-count command. ✓

**Type consistency:** The gutted `quickStartFlow.ts` keeps both enum names (`QUICKSTART_METHOD`, `QUICKSTART_ACTION_TYPE`) and all members, exactly as the surviving importers (ModpackBrowser, market/index.vue, CreateInstanceForm, useGenerateStartCmd, CmdAssistantDialog) reference them. The `manual-install` emit still carries `QUICKSTART_METHOD`. ✓
