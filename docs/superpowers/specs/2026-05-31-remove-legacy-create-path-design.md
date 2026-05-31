# Remove the Legacy Manual-Create Subsystem — Design

**Status:** Approved 2026-05-31. Ready for `writing-plans` → subagent-driven execution.
**Roadmap #18.** Branch: `test` (per the two-branch model).

## Goal
Make instance creation Minecraft-centric by removing the legacy MCSManager manual-create paths. After this, the **modpack browser is the single create path** — Vanilla/Java builder + CurseForge + Modrinth + Import. The generic "Create a New Instance" form (with the legacy Instance-Type dropdown full of Steam/Terraria/Hytale/Web-Shell/General-Console types) and the `/quickstart` wizard are no longer reachable.

## Rationale
The modpack browser already creates any Java version + software (Vanilla/Paper/Purpur/Folia/Fabric/Forge/NeoForge/Quilt) and Bedrock, and the Import tab brings in existing servers. The legacy quick-start subsystem and the "Create Directly" manual form duplicate this and expose non-Minecraft instance types that don't belong in a Minecraft-only panel.

## Scope decisions (confirmed with user)
- **Full cleanup** (not minimal): remove the "Create Directly" link AND retire the entire legacy `/quickstart` subsystem.
- **Velocity/BungeeCord proxies:** out of scope here. Proxy support (add **Velocity** to the modpack-browser software picker, via the PaperMC API) is a **separate future task** — not a reason to keep the legacy form.
- Keep the Import flow exactly as-is.

## What gets removed (all wizard-only)

### Frontend
- **`frontend/src/widgets/market/ModpackBrowser.vue`** — remove only the **"Create Directly"** link in the Import panel (the `<a class="import-empty-link" @click="emit('manual-install', QUICKSTART_METHOD.EXIST)">`, label `TXT_CODE_e0fca76`). The "Import Compressed Package" button (`emit('manual-install', QUICKSTART_METHOD.IMPORT)`) stays. Everything else in this file is untouched.
- **Delete files:**
  - `frontend/src/widgets/QuickStart.vue` (the QuickStart card → navigates to `/quickstart`)
  - `frontend/src/widgets/setupApp/QuickStartFlow.vue` (the 5-step wizard)
  - `frontend/src/widgets/setupApp/McPreset.vue` (the `/quickstart/minecraft` presets page)
- **`frontend/src/config/router.ts`** — delete the `/quickstart` route and its child `/quickstart/minecraft`.
- **`frontend/src/config/index.ts`** — delete the imports for `QuickStart`, `QuickStartFlow`, `McPreset`; their entries in the `LAYOUT_CARD_TYPES` map; and the `QuickStart` card-pool entry. (None of these three are placed on a default page, so removing them leaves no layout hole.)
- **`frontend/src/hooks/widgets/quickStartFlow.ts`** — **gut to just the two enums.** Delete the `useQuickStartFlow()` hook and any imports it needs; KEEP the exported enums `QUICKSTART_METHOD` and `QUICKSTART_ACTION_TYPE` (they are imported by surviving code — see "What stays"). Keeping the file at its current path means none of the surviving import statements change (lowest-risk). Add a short header comment noting the file now only holds the shared instance enums.

### Panel
- **`panel/src/app/service/frontend_layout.ts`** — delete the two default-page blocks: `page: "/quickstart"` (the `QuickStartFlow` card) and `page: "/quickstart/minecraft"` (the `McPreset` + `EmptyCard`).

### i18n
- **`languages/en_US.json`** — remove the now-orphaned wizard-only keys (the game-type button labels, step titles, and the "Create Directly" link label `TXT_CODE_e0fca76`). Only remove keys with NO remaining reference in code; when unsure, leave the key (orphaned keys are harmless). Do not touch keys still used by `CreateInstanceForm` / the Import flow.

## What stays (shared or still used)
- **`frontend/src/widgets/market/ModpackBrowser.vue`**, **`frontend/src/widgets/market/index.vue`**, **`frontend/src/widgets/setupApp/CreateInstanceForm.vue`** — the modpack browser + Import flow. After this change, `CreateInstanceForm` is only ever instantiated in **IMPORT** mode (from `market/index.vue`, driven by the Import button). The `manual-install` emit type stays `QUICKSTART_METHOD` (now only `IMPORT` is emitted).
- **`QUICKSTART_METHOD`** enum — used by `ModpackBrowser.vue`, `market/index.vue`, `CreateInstanceForm.vue` (Import flow). KEEP.
- **`QUICKSTART_ACTION_TYPE`** enum — used by `CreateInstanceForm.vue` (`changeInstanceType`), `useGenerateStartCmd.ts`, `CmdAssistantDialog`. KEEP (all values).
- **`frontend/src/hooks/useGenerateStartCmd.ts`** and **`frontend/src/components/fc/CmdAssistantDialog/index.vue`** — the independent command-writing helper used in instance settings. KEEP (not part of create).

## Deliberately NOT done (documented so it's not a surprise)
- **Trimming `CreateInstanceForm`'s dead branches.** Once the manual paths are gone, its non-import branches (the legacy Instance-Type dropdown that iterates `INSTANCE_TYPE_TRANSLATION`, plus the EXIST/FILE/DOCKER form sections) become unreachable dead code. We **leave them intact** to avoid any risk to the working Import flow. Optional future cleanup.
- The command-assistant (`CmdAssistantDialog`) still offering Steam/Universal command presets — separate feature, out of scope.
- Adding Velocity (proxy) to the builder — separate future task.

## Edge cases / risks
- **User-customized layout:** if a saved layout happened to include the `QuickStart` card, removing its type means `LAYOUT_CARD_TYPES["QuickStart"]` is undefined and that card won't render. Acceptable (the card is not on any default page; single-user instance). No migration needed.
- **No nav link breakage:** `/quickstart` is reached ONLY via the `QuickStart` card's buttons (no sidebar/menu link). Removing the card removes the only entrypoint; deleting the routes is then safe.
- **Import flow untouched:** the only behavioral change to `market/`/`CreateInstanceForm` is that `EXIST`/manual modes are no longer triggered. IMPORT is unaffected.

## Verification
1. `npm run build --prefix daemon` · `npm run build --prefix panel` · `npm run type-check --prefix frontend` — all clean (no dangling imports to the deleted files/exports).
2. Manual (Test stack): the modpack browser still creates a Java instance (Vanilla/builder), a Bedrock instance, and a CurseForge/Modrinth modpack; the **Import / Existing** tab still imports a zip (and no longer shows a "Create Directly" link).
3. Navigating to `/quickstart` or `/quickstart/minecraft` no longer resolves to the wizard (route removed); nothing in the UI links there.
4. No console errors about unknown card types / missing components on the default pages.
