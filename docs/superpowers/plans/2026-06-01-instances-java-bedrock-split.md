# Instances Java/Bedrock Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show each instance card's edition at a glance (Java/Bedrock badge + colored accent stripe) and add an All/Java/Bedrock toolbar filter that filters server-side across all pages.

**Architecture:** (B) Badge + stripe are pure client-side in `Shortcut.vue` (reads `config.type`). (C) Filter threads a new `type` ("java"|"bedrock"|"") param: frontend `InstanceList.vue` toolbar → `remoteInstances` API → panel `daemon_router.ts` proxy → daemon `instance/select` filter closure — mirroring the existing status filter.

**Tech Stack:** Vue 3 + Ant Design Vue, Koa (panel), socket RPC (daemon).

---

## Conventions
- Gate = `npm run build --prefix daemon` / `--prefix panel` / `npm run type-check --prefix frontend` + en_US valid. PowerShell PATH prefix:
  ```powershell
  $env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
  ```
- Branch `test`. Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Spec: `docs/superpowers/specs/2026-06-01-instances-java-bedrock-split-design.md`.
- **Scope:** single-node card view only. Global-daemon tree view + the global proxy are out of scope (don't pass `type` there; hide the filter in global mode).
- **CardPanel note:** `CardPanel.vue` root has a fixed `:class` and does NOT forward an external class. The card root is `position: relative`. So the accent stripe goes as an absolutely-positioned element INSIDE `Shortcut.vue`'s `#body` slot (or a stripe div anchored to the relative card root), NOT via a class on CardPanel.

## File map
- Modify: `frontend/src/widgets/instance/Shortcut.vue` — edition computed, badge, accent stripe (B).
- Modify: `daemon/src/routers/Instance_router.ts` — type filter in `instance/select` (C).
- Modify: `panel/src/app/routers/daemon_router.ts` — thread `type` query param (single-node handler) (C).
- Modify: `frontend/src/services/apis/index.ts` — add `type?` to `remoteInstances` params (C).
- Modify: `frontend/src/widgets/InstanceList.vue` — `operationForm.type`, pass it, toolbar filter control (C).
- Modify: `languages/en_US.json` — i18n.

---

## Task 1: Daemon type filter

**Files:** `daemon/src/routers/Instance_router.ts`

- [ ] **Step 1: Add the type filter in the `instance/select` closure**

READ the `instance/select` handler. Find the `queryWrapper.select<Instance>((v) => { ... })` filter closure, specifically the tag-filter block ending before `return true;`. Add immediately before `return true;`:
```typescript
    // TYPE FILTER (edition): condition.type is "java" | "bedrock" | undefined
    if (condition.type) {
      const ty = String(v.config.type || "");
      const isBedrock = ty.includes("bedrock");
      if (condition.type === "bedrock" && !isBedrock) return false;
      if (condition.type === "java" && (isBedrock || !ty.includes("minecraft"))) return false;
    }
```
(`condition` is already the object the handler reads `instanceName`/`status`/`tag` from; `condition.type` is undefined when not sent → no filtering.)

- [ ] **Step 2: Build daemon**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
```
Expected: compiles. (If `condition` is typed and rejects `.type`, widen the access — read how `condition.status`/`condition.tag` are accessed; if `condition` is `any`/loosely typed, no change needed.)

- [ ] **Step 3: Commit**
```powershell
git add daemon/src/routers/Instance_router.ts
git commit -m @'
feat(instances): daemon type (java/bedrock) filter in instance/select

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 2: Panel proxy threads `type`

**Files:** `panel/src/app/routers/daemon_router.ts`

- [ ] **Step 1: Pass `type` through the single-node `/remote_service_instances` handler**

READ the handler. It extracts `instance_name`, `status`, `tag` from `ctx.query` and builds a `condition` object for `instance/select`. Add a `type` read + include it in `condition`:
- Near `const status = ctx.query.status;`, add:
```typescript
      const type = ctx.query.type ? String(ctx.query.type) : undefined;
```
- In the `condition: { instanceName, status, tag: ... }` object, add `type`:
```typescript
        condition: {
          instanceName,
          status,
          type,
          tag: tagList.length > 0 ? tagList : null
        }
```
- If the route has a strict `validator({ query: {...} })`, add `type: String` as an optional allowance ONLY if the validator rejects unknown query keys. (Check how the validator is configured — the existing one validates `daemonId/page/page_size`; extra query params are typically allowed. If extras are rejected, add `type` as optional.)

Do NOT modify the global `/remote_services_instances_global` handler (type filter is single-node scope).

- [ ] **Step 2: Build panel**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix panel
```
Expected: compiles.

- [ ] **Step 3: Commit**
```powershell
git add panel/src/app/routers/daemon_router.ts
git commit -m @'
feat(instances): panel proxies the type filter param (single-node list)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 3: Frontend API param + i18n

**Files:** `frontend/src/services/apis/index.ts`, `languages/en_US.json`

- [ ] **Step 1: Add `type?` to `remoteInstances` params**

In `frontend/src/services/apis/index.ts`, the `remoteInstances` `useDefineApi` params type lists `daemonId/page/page_size/instance_name?/status?/tag?`. Add:
```typescript
      type?: string;
```

- [ ] **Step 2: Add i18n keys to `languages/en_US.json`**

Add (near other instance-list/filter keys):
```json
  "TXT_CODE_edition_java": "Java",
  "TXT_CODE_edition_bedrock": "Bedrock",
  "TXT_CODE_filter_all_types": "All Types",
```

- [ ] **Step 3: Validate JSON + type-check frontend**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
node -e "JSON.parse(require('fs').readFileSync('languages/en_US.json','utf8')); console.log('OK')"
npm run type-check --prefix frontend
```
Expected: `OK` + clean type-check.

- [ ] **Step 4: Commit**
```powershell
git add frontend/src/services/apis/index.ts languages/en_US.json
git commit -m @'
feat(instances): remoteInstances type param + edition/filter i18n

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 4: Per-card badge + accent stripe (B)

**Files:** `frontend/src/widgets/instance/Shortcut.vue`

READ the file. Relevant spots: the `<script setup>` computeds (after `displayIcon`), the status-tag row in the template (`<div class="mb-8 flex" ...>` containing the status `<a-tag>` and tag chips), and the `<style scoped>` block.

- [ ] **Step 1: Add the edition computed**

In `<script setup>`, after the `displayIcon` computed, add:
```typescript
// Java vs Bedrock edition for the at-a-glance badge + accent stripe.
const instanceEdition = computed(() => {
  const ty = String(instanceInfo.value?.config?.type || "");
  if (ty.includes("bedrock")) return "bedrock";
  if (ty.includes("minecraft")) return "java";
  return "";
});
```

- [ ] **Step 2: Add the badge in the status-tag row**

In the template, inside the `<div class="mb-8 flex" style="flex-wrap: wrap; gap: 8px">` (the row with the status tag), add an edition badge right after the status `<a-tag>...</a-tag>` (before the tag-chips `<div v-if="...tag">|</div>`):
```vue
            <a-tag
              v-if="instanceEdition"
              class="m-0 edition-tag"
              :class="instanceEdition === 'bedrock' ? 'edition-bedrock' : 'edition-java'"
            >
              {{ instanceEdition === "bedrock" ? t("TXT_CODE_edition_bedrock") : t("TXT_CODE_edition_java") }}
            </a-tag>
```

- [ ] **Step 3: Add the accent stripe element**

The card root (`CardPanel`) is `position: relative`. Add an absolutely-positioned stripe as the FIRST child inside the `#body` slot's container. In the template, find `<div class="instance-card-body">` and add immediately inside it (as the first element):
```vue
        <div v-if="instanceEdition" class="edition-stripe" :class="'edition-stripe-' + instanceEdition"></div>
```

- [ ] **Step 4: Add the scoped styles**

In the `<style scoped>` block, add:
```scss
.edition-tag {
  border: none;
  font-weight: 600;
}
.edition-java {
  background: rgba(108, 186, 58, 0.16);
  color: #76c93f;
}
.edition-bedrock {
  background: rgba(43, 179, 163, 0.18);
  color: #3fc9b9;
}
/* Left accent stripe anchored to the relative card root. */
.edition-stripe {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-top-left-radius: inherit;
  border-bottom-left-radius: inherit;
}
.edition-stripe-java {
  background: #6cba3a;
}
.edition-stripe-bedrock {
  background: #2bb3a3;
}
```
Note: the stripe is positioned against the nearest positioned ancestor. The `.instance-card-body` is inside `.card-panel-content` (which is `position: relative` per CardPanel) — so the stripe will anchor to the content box. If in testing the stripe doesn't span the FULL card height (because it anchors to the content, not the padded card root), an acceptable alternative is to keep it anchored to the content box (still a clear left accent). Verify visually; if full-height is wanted and the content-anchored stripe looks off, move the stripe so it's a sibling positioned against `.card-panel` — but since CardPanel doesn't expose that, the content-anchored stripe is the pragmatic choice. Prefer the simple version; note the result.

- [ ] **Step 5: Type-check frontend**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run type-check --prefix frontend
```
Expected: no errors.

- [ ] **Step 6: Commit**
```powershell
git add frontend/src/widgets/instance/Shortcut.vue
git commit -m @'
feat(instances): per-card Java/Bedrock badge + accent stripe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 5: Toolbar filter control (C)

**Files:** `frontend/src/widgets/InstanceList.vue`

READ the file: `operationForm` (~line 52), the `getInstances({ params })` call (~line 114), the toolbar status `<a-select>` (~line 596-626), `handleQueryInstance`, and `isGlobalDaemonMode`.

- [ ] **Step 1: Add `type` to `operationForm`**
```typescript
const operationForm = ref({
  instanceName: "",
  currentPage: 1,
  pageSize: 20,
  status: "",
  type: ""
});
```

- [ ] **Step 2: Pass `type` in the single-node `getInstances` call**

In the non-global `getInstances({ params: {...} })` call (the one with `daemonId: currentRemoteNode?.uuid`), add:
```typescript
        type: operationForm.value.type,
```
(Do NOT add it to the global-daemon fetch path.)

- [ ] **Step 3: Add the filter control in the toolbar**

Next to the status `<a-select>` (inside the same search-input group, before or after the status select), add a type filter — hidden in global mode:
```vue
      <a-select
        v-if="!isGlobalDaemonMode"
        v-model:value="operationForm.type"
        style="width: 110px"
        @change="handleQueryInstance"
      >
        <a-select-option value="">{{ t("TXT_CODE_filter_all_types") }}</a-select-option>
        <a-select-option value="java">{{ t("TXT_CODE_edition_java") }}</a-select-option>
        <a-select-option value="bedrock">{{ t("TXT_CODE_edition_bedrock") }}</a-select-option>
      </a-select>
```
Place it adjacent to the status select within the `<a-input-group compact>` (adjust widths so the row still fits — e.g. status 90px, type 110px, name input fills the rest). Match the existing markup/indentation.

- [ ] **Step 4: Reset to page 1 on filter change**

Confirm `handleQueryInstance` resets the page (the status filter uses it; check whether it sets `currentPage = 1` or calls `initInstancesData(true)`). If status filtering already resets the page via `handleQueryInstance`, the type filter using the same handler inherits that — good. If NOT (status filtering doesn't reset page), make the type select's `@change` set `operationForm.value.currentPage = 1` before refetch. READ `handleQueryInstance` / `initInstancesData` to confirm and do whichever keeps behavior consistent with the status filter.

- [ ] **Step 5: Type-check frontend**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run type-check --prefix frontend
```
Expected: no errors.

- [ ] **Step 6: Commit**
```powershell
git add frontend/src/widgets/InstanceList.vue
git commit -m @'
feat(instances): All/Java/Bedrock type filter in the toolbar (single-node)

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
Expected: all clean.

- [ ] **Step 2: Push**
```powershell
git push origin test
```

- [ ] **Step 3: Hand off for manual verification (both images)**

Rebuild `nexcraft-web` + `nexcraft-daemon` `:test`, force-update both Test containers, then on the single-node Instances view: each card shows a **Java** (green) or **Bedrock** (teal) badge + matching left stripe. The toolbar **All/Java/Bedrock** select narrows the list. To prove it filters server-side (not just the page), set page size small (or add instances) so the result spans pages and confirm Java-only shows ALL Java across pages. Switching the filter returns to page 1. Confirm the global-daemon view still works (filter control hidden, no errors).

---

## Self-Review

**Spec coverage:** (B) badge + accent per card reading `config.type` → Task 4 (`instanceEdition`, badge in status row, stripe) ✓ · distinct edition colors (not status-green) → Task 4 scoped CSS ✓ · (C) type filter as a real daemon param → Task 1 (daemon closure), Task 2 (panel proxy), Task 3 (frontend API), Task 5 (toolbar UI) ✓ · filters across all pages (server-side) → daemon-side filter ✓ · single-node scope, global mode excluded → Task 2 (global handler untouched), Task 5 (`v-if="!isGlobalDaemonMode"`) ✓ · reset to page 1 on change → Task 5 Step 4 ✓ · non-Minecraft → no badge/stripe, only "All" matches → `instanceEdition` returns "" + daemon `java` requires `minecraft` ✓ · i18n → Task 3 ✓.

**Placeholder scan:** Concrete code throughout. The two "verify against the file" notes (Task 2 validator strictness, Task 5 page-reset behavior, Task 4 stripe anchoring) are conform-to-reality checks with the decision spelled out, not placeholders.

**Type consistency:** `type` value domain is `""` | `"java"` | `"bedrock"` everywhere — frontend `operationForm.type` + select options (Task 5), API param (Task 3), panel `condition.type` (Task 2), daemon comparison `condition.type === "java"/"bedrock"` (Task 1). Badge `instanceEdition` returns `"java"|"bedrock"|""` and drives both the `<a-tag>` class and the stripe class. i18n keys `TXT_CODE_edition_java`/`_bedrock`/`filter_all_types` used in Tasks 4+5, defined in Task 3. ✓
