# Richer Non-Modpack Install Detail (#30) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Enrich the modpack-browser Details tab for curated software (vanilla/bedrock/paper/purpur/folia/fabric/forge/neoforge/quilt) with a tags row, a Key Features list, and a Java auto-provision note — matching the richness of the modpack detail.

**Architecture:** Curated static data only. Extend `LOADER_INFO` (loaderInfo.ts) with `categoryKeys` + `featureKeys`; add the i18n strings; render them in the existing `custom-detail` block of `ModpackBrowser.vue`. No backend.

**Tech Stack:** Vue 3 + Ant Design Vue + vue-i18n.

---

## Conventions
- No test runner — gate is **`npm run type-check --prefix frontend`** + JSON validity. PowerShell PATH prefix before npm/node:
  ```powershell
  $env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
  ```
- Branch `test` (already checked out). Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Spec: `docs/superpowers/specs/2026-05-31-rich-software-detail-design.md`. Approved mockup: `docs/mockups/install-detail-30-mockup.html`.

## File map
- Modify: `frontend/src/tools/loaderInfo.ts` (extend LOADER_INFO type + entries)
- Modify: `languages/en_US.json` (add category/feature/java keys; set blurb values)
- Modify: `frontend/src/widgets/market/ModpackBrowser.vue` (custom-detail template + a `capitalize` helper + styles)

---

## Task 1: Data model + i18n strings

**Files:** `frontend/src/tools/loaderInfo.ts`, `languages/en_US.json`

- [ ] **Step 1: Replace `frontend/src/tools/loaderInfo.ts` contents**

```ts
// Per-loader description (i18n key) + official link + curated tags/features for the
// custom builder's Details tab.
export const LOADER_INFO: Record<
  string,
  { blurbKey: string; url: string; categoryKeys: string[]; featureKeys: string[] }
> = {
  vanilla: {
    blurbKey: "TXT_CODE_loader_blurb_vanilla",
    url: "https://www.minecraft.net/",
    categoryKeys: ["TXT_CODE_loader_cat_vanilla", "TXT_CODE_loader_cat_java"],
    featureKeys: [
      "TXT_CODE_loader_feat_vanilla_1",
      "TXT_CODE_loader_feat_vanilla_2",
      "TXT_CODE_loader_feat_vanilla_3",
      "TXT_CODE_loader_feat_vanilla_4"
    ]
  },
  paper: {
    blurbKey: "TXT_CODE_loader_blurb_paper",
    url: "https://papermc.io/software/paper",
    categoryKeys: ["TXT_CODE_loader_cat_plugin", "TXT_CODE_loader_cat_java"],
    featureKeys: [
      "TXT_CODE_loader_feat_paper_1",
      "TXT_CODE_loader_feat_paper_2",
      "TXT_CODE_loader_feat_paper_3",
      "TXT_CODE_loader_feat_paper_4"
    ]
  },
  purpur: {
    blurbKey: "TXT_CODE_loader_blurb_purpur",
    url: "https://purpurmc.org/",
    categoryKeys: ["TXT_CODE_loader_cat_plugin", "TXT_CODE_loader_cat_java"],
    featureKeys: [
      "TXT_CODE_loader_feat_purpur_1",
      "TXT_CODE_loader_feat_purpur_2",
      "TXT_CODE_loader_feat_purpur_3",
      "TXT_CODE_loader_feat_purpur_4"
    ]
  },
  folia: {
    blurbKey: "TXT_CODE_loader_blurb_folia",
    url: "https://papermc.io/software/folia",
    categoryKeys: ["TXT_CODE_loader_cat_plugin", "TXT_CODE_loader_cat_java"],
    featureKeys: [
      "TXT_CODE_loader_feat_folia_1",
      "TXT_CODE_loader_feat_folia_2",
      "TXT_CODE_loader_feat_folia_3",
      "TXT_CODE_loader_feat_folia_4"
    ]
  },
  fabric: {
    blurbKey: "TXT_CODE_loader_blurb_fabric",
    url: "https://fabricmc.net/",
    categoryKeys: ["TXT_CODE_loader_cat_modloader", "TXT_CODE_loader_cat_java"],
    featureKeys: [
      "TXT_CODE_loader_feat_fabric_1",
      "TXT_CODE_loader_feat_fabric_2",
      "TXT_CODE_loader_feat_fabric_3",
      "TXT_CODE_loader_feat_fabric_4"
    ]
  },
  forge: {
    blurbKey: "TXT_CODE_loader_blurb_forge",
    url: "https://forums.minecraftforge.net/",
    categoryKeys: ["TXT_CODE_loader_cat_modloader", "TXT_CODE_loader_cat_java"],
    featureKeys: [
      "TXT_CODE_loader_feat_forge_1",
      "TXT_CODE_loader_feat_forge_2",
      "TXT_CODE_loader_feat_forge_3",
      "TXT_CODE_loader_feat_forge_4"
    ]
  },
  neoforge: {
    blurbKey: "TXT_CODE_loader_blurb_neoforge",
    url: "https://neoforged.net/",
    categoryKeys: ["TXT_CODE_loader_cat_modloader", "TXT_CODE_loader_cat_java"],
    featureKeys: [
      "TXT_CODE_loader_feat_neoforge_1",
      "TXT_CODE_loader_feat_neoforge_2",
      "TXT_CODE_loader_feat_neoforge_3",
      "TXT_CODE_loader_feat_neoforge_4"
    ]
  },
  quilt: {
    blurbKey: "TXT_CODE_loader_blurb_quilt",
    url: "https://quiltmc.org/",
    categoryKeys: ["TXT_CODE_loader_cat_modloader", "TXT_CODE_loader_cat_java"],
    featureKeys: [
      "TXT_CODE_loader_feat_quilt_1",
      "TXT_CODE_loader_feat_quilt_2",
      "TXT_CODE_loader_feat_quilt_3",
      "TXT_CODE_loader_feat_quilt_4"
    ]
  },
  bedrock: {
    blurbKey: "TXT_CODE_loader_blurb_bedrock",
    url: "https://www.minecraft.net/download/server/bedrock",
    categoryKeys: ["TXT_CODE_loader_cat_bedrock"],
    featureKeys: [
      "TXT_CODE_loader_feat_bedrock_1",
      "TXT_CODE_loader_feat_bedrock_2",
      "TXT_CODE_loader_feat_bedrock_3",
      "TXT_CODE_loader_feat_bedrock_4"
    ]
  }
};
```

- [ ] **Step 2: Add the new i18n keys to `languages/en_US.json`**

Insert these keys (place them near the existing `TXT_CODE_loader_blurb_*` / `TXT_CODE_loader_learn_more` keys). Use the Edit tool; ensure valid JSON (commas correct):
```json
  "TXT_CODE_loader_features": "Key Features",
  "TXT_CODE_loader_java_autoprovision": "Java is auto-provisioned to match this version — no manual setup needed.",
  "TXT_CODE_loader_cat_java": "Java",
  "TXT_CODE_loader_cat_vanilla": "Vanilla",
  "TXT_CODE_loader_cat_bedrock": "Bedrock",
  "TXT_CODE_loader_cat_plugin": "Plugin server",
  "TXT_CODE_loader_cat_modloader": "Mod loader",
  "TXT_CODE_loader_feat_vanilla_1": "Official Mojang dedicated server",
  "TXT_CODE_loader_feat_vanilla_2": "Most stable; day-one support for new versions",
  "TXT_CODE_loader_feat_vanilla_3": "Datapacks & resource packs supported",
  "TXT_CODE_loader_feat_vanilla_4": "No plugin or mod API",
  "TXT_CODE_loader_feat_bedrock_1": "Cross-play across mobile, console & Windows",
  "TXT_CODE_loader_feat_bedrock_2": "Official Mojang BDS binary",
  "TXT_CODE_loader_feat_bedrock_3": "Add-ons + behavior / resource packs",
  "TXT_CODE_loader_feat_bedrock_4": "Runs natively — no Java required",
  "TXT_CODE_loader_feat_paper_1": "High-performance Spigot / Bukkit fork",
  "TXT_CODE_loader_feat_paper_2": "Full Bukkit / Spigot plugin API",
  "TXT_CODE_loader_feat_paper_3": "Async chunk loading, anti-cheat & timings",
  "TXT_CODE_loader_feat_paper_4": "Thousands of compatible plugins",
  "TXT_CODE_loader_feat_purpur_1": "Drop-in Paper fork — Paper plugins just work",
  "TXT_CODE_loader_feat_purpur_2": "Hundreds of extra config toggles",
  "TXT_CODE_loader_feat_purpur_3": "Fun gameplay tweaks (rideable mobs & more)",
  "TXT_CODE_loader_feat_purpur_4": "Performance-focused",
  "TXT_CODE_loader_feat_folia_1": "Regionised multithreading — scales across CPU cores",
  "TXT_CODE_loader_feat_folia_2": "Built for big, spread-out player bases",
  "TXT_CODE_loader_feat_folia_3": "Paper-based",
  "TXT_CODE_loader_feat_folia_4": "Needs Folia-compatible plugins",
  "TXT_CODE_loader_feat_fabric_1": "Lightweight; updates to new MC versions quickly",
  "TXT_CODE_loader_feat_fabric_2": "Pairs with Fabric API",
  "TXT_CODE_loader_feat_fabric_3": "Popular for client & server mods",
  "TXT_CODE_loader_feat_fabric_4": "Large, active modding community",
  "TXT_CODE_loader_feat_forge_1": "The original, most widely-supported mod loader",
  "TXT_CODE_loader_feat_forge_2": "Powers most big modpacks",
  "TXT_CODE_loader_feat_forge_3": "Extensive modding API",
  "TXT_CODE_loader_feat_forge_4": "Best for content-heavy packs",
  "TXT_CODE_loader_feat_neoforge_1": "Community-driven Forge fork",
  "TXT_CODE_loader_feat_neoforge_2": "Modern, actively-developed API",
  "TXT_CODE_loader_feat_neoforge_3": "Growing modpack adoption",
  "TXT_CODE_loader_feat_neoforge_4": "Forge-like modding model",
  "TXT_CODE_loader_feat_quilt_1": "Fabric-compatible mod loader",
  "TXT_CODE_loader_feat_quilt_2": "Most Fabric mods run on Quilt",
  "TXT_CODE_loader_feat_quilt_3": "Extra hooks & the QSL library",
  "TXT_CODE_loader_feat_quilt_4": "Community-driven",
```

- [ ] **Step 3: Set the 9 blurb values to the approved copy**

The `TXT_CODE_loader_blurb_*` keys already exist. Update each one's VALUE to match (use Edit per key; if a value already matches, leave it):
```json
  "TXT_CODE_loader_blurb_vanilla": "The official Mojang server — pure Minecraft, no mods or plugins.",
  "TXT_CODE_loader_blurb_bedrock": "The official Bedrock Dedicated Server for cross-platform play.",
  "TXT_CODE_loader_blurb_paper": "A high-performance Spigot fork with a huge plugin ecosystem.",
  "TXT_CODE_loader_blurb_purpur": "A drop-in Paper fork with hundreds of extra gameplay & config options.",
  "TXT_CODE_loader_blurb_folia": "A Paper fork using regionised multithreading for very large player counts.",
  "TXT_CODE_loader_blurb_fabric": "A lightweight, fast-updating mod loader with a big community.",
  "TXT_CODE_loader_blurb_forge": "The long-standing mod loader behind most large modpacks.",
  "TXT_CODE_loader_blurb_neoforge": "A modern, community-driven fork of Forge.",
  "TXT_CODE_loader_blurb_quilt": "A community fork of Fabric with extra features and tooling."
```

- [ ] **Step 4: Validate JSON + type-check**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
node -e "JSON.parse(require('fs').readFileSync('languages/en_US.json','utf8')); console.log('en_US.json OK')"
npm run type-check --prefix frontend
```
Expected: `en_US.json OK` and no type errors. (The template doesn't use the new fields yet, so this just confirms the data + JSON are valid.)

- [ ] **Step 5: Commit**
```powershell
git add frontend/src/tools/loaderInfo.ts languages/en_US.json
git commit -m @'
feat(#30): curated tags + features + Java-note data for builder software

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 2: Render the enriched detail in ModpackBrowser.vue

**Files:** `frontend/src/widgets/market/ModpackBrowser.vue`

- [ ] **Step 1: Add a `capitalize` helper in `<script setup>`**

Add near the other small helpers (e.g. by `formatUpdated`):
```ts
const capitalize = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
```

- [ ] **Step 2: Replace the custom-detail block in `<template>`**

Find the existing block (the `<div v-if="dialog.item && source === 'custom'" class="pack-detail custom-detail">` … its closing `</div>`, which currently ends with the `<p ... class="pack-desc">{{ t(currentLoaderInfo.blurbKey) }}</p>`). Replace the WHOLE block with:
```vue
        <div v-if="dialog.item && source === 'custom'" class="pack-detail custom-detail">
          <div class="pack-head">
            <img v-if="loaderIcon" :src="loaderIcon" class="loader-detail-icon" alt="" />
            <div class="pack-head-text">
              <div class="pack-title">{{ currentLoaderLabel() }} {{ dialog.item.id }}</div>
              <div class="pack-meta">
                <span>{{ dialog.item.description }}</span>
                <span v-if="dialog.selectedLoaderVersion"> · {{ dialog.selectedLoaderVersion }}</span>
              </div>
              <a v-if="currentLoaderInfo" :href="currentLoaderInfo.url" target="_blank" rel="noopener">
                {{ t("TXT_CODE_loader_learn_more") }}
              </a>
            </div>
          </div>

          <div v-if="currentLoaderInfo" class="pack-tags">
            <a-tag color="blue">{{ dialog.item.id }}</a-tag>
            <a-tag v-if="dialog.item.mcType">{{ capitalize(dialog.item.mcType) }}</a-tag>
            <a-tag v-for="ck in currentLoaderInfo.categoryKeys" :key="ck">{{ t(ck) }}</a-tag>
          </div>

          <p v-if="currentLoaderInfo" class="pack-desc">{{ t(currentLoaderInfo.blurbKey) }}</p>

          <template v-if="currentLoaderInfo">
            <div class="loader-feat-h">{{ t("TXT_CODE_loader_features") }}</div>
            <ul class="loader-feat">
              <li v-for="fk in currentLoaderInfo.featureKeys" :key="fk">{{ t(fk) }}</li>
            </ul>
            <div v-if="customLoader !== 'bedrock'" class="loader-java-note">
              {{ t("TXT_CODE_loader_java_autoprovision") }}
            </div>
          </template>
        </div>
```
Notes: `dialog.item.mcType` is already set for custom version items (`mcType: v.type`). `customLoader` is a ref — it auto-unwraps in the template, so `customLoader !== 'bedrock'` is correct. `.pack-tags` and `.pack-desc` styles already exist (reused from the modpack detail).

- [ ] **Step 3: Add the new styles in `<style lang="scss" scoped>`**

Add (near the other `.custom-detail` / `.pack-*` rules):
```scss
.custom-detail .loader-feat-h {
  margin: 14px 0 6px;
  font-weight: 600;
  font-size: 13px;
}
.custom-detail .loader-feat {
  margin: 0;
  padding-left: 18px;
  li {
    margin: 3px 0;
  }
}
.custom-detail .loader-java-note {
  margin-top: 14px;
  padding: 8px 10px;
  font-size: 12.5px;
  border-radius: 6px;
  border: 1px solid var(--color-blue-5, #2b4a6b);
  background: rgba(74, 144, 217, 0.1);
}
```
(If `var(--color-blue-5, ...)` isn't a project token, the fallback hex is used — fine. Match a neighbouring style's token convention if one exists.)

- [ ] **Step 4: Type-check**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run type-check --prefix frontend
```
Expected: no errors. (If vue-tsc complains `dialog.item.mcType` is not on the item type, widen the dialog.item type or cast — but it should exist since the version items carry `mcType`.)

- [ ] **Step 5: Commit**
```powershell
git add frontend/src/widgets/market/ModpackBrowser.vue
git commit -m @'
feat(#30): render tags + Key Features + Java auto-provision note on the software detail

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 3: Build verification + push

- [ ] **Step 1: Full builds**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run type-check --prefix frontend
npm run build --prefix frontend
```
Expected: clean. (daemon/panel unaffected — frontend-only change.)

- [ ] **Step 2: Push**
```powershell
git push origin test
```

- [ ] **Step 3: Hand off for manual verification (web-only)**

Rebuild `nexcraft-web` `:test` + force-update `NexCraft-Web-Test`, then for EACH of the 9 software (vanilla/bedrock/paper/purpur/folia/fabric/forge/neoforge/quilt): open the builder → pick the software → open a version's Details. Confirm it shows: the tags row (version + Release/Snapshot + categories), the **Key Features** list, and — for all except **Bedrock** — the **Java auto-provision** note. Compare against the approved mockup.

---

## Self-Review

**Spec coverage:** tags row (Task 2 Step 2) ✓ · Key Features list (Task 2 Step 2 + features data Task 1) ✓ · Java note Java-only (Task 2 Step 2, `customLoader !== 'bedrock'`) ✓ · curated content for all 9 (Task 1) ✓ · data model `categoryKeys`/`featureKeys` (Task 1 Step 1) ✓ · i18n incl. blurb updates (Task 1 Steps 2-3) ✓ · no backend/hero (not in plan) ✓ · verification (Task 3) ✓.

**Placeholder scan:** all copy is concrete (full LOADER_INFO + full i18n block + full template). No TBD. ✓

**Type consistency:** `categoryKeys`/`featureKeys` names match between loaderInfo.ts (Task 1) and the template `currentLoaderInfo.categoryKeys`/`.featureKeys` (Task 2). `currentLoaderInfo` is the existing `computed(() => LOADER_INFO[customLoader.value])`. Key names in en_US (Task 1 Step 2) exactly match the keys referenced in loaderInfo.ts and the template (`TXT_CODE_loader_features`, `TXT_CODE_loader_java_autoprovision`). ✓
