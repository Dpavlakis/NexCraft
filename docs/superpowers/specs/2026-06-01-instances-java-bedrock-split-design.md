# Instances — Java/Bedrock Split (badge + filter) — Design

**Status:** Approved 2026-06-01 (brainstorm + mockup approved: option **B + C**). Ready for `writing-plans` → subagent-driven execution.
Branch: `test`. Frontend + a small daemon/panel filter param. Mockup: `docs/mockups/instances-java-bedrock-split.html`.

## Goal
On the Instances screen, make a server's edition obvious at a glance, and let the user isolate one edition:
- **(B) Per-card type badge + accent stripe** — each instance card shows a `JAVA`/`BEDROCK` chip and a colored left accent stripe (Java = grass-green, Bedrock = slate-teal). Pure client-side (the type is already on each card). Pagination-proof.
- **(C) Type filter** — an All / Java / Bedrock control in the toolbar that filters the list. Implemented as a real **daemon query param** (like the existing status/name/tag filters) so it filters across ALL pages, not just the visible one.

## Why a daemon filter (not client-side)
The instance list is server-paginated (20/page). Filtering only the current page client-side would hide matching instances on other pages. Status/name/tag already filter at the daemon (`instance/select`); type joins them for consistency and correctness.

## Scope
- Applies to the normal **single-node card view** (`!isGlobalDaemonMode`). The **global multi-daemon tree view** (`tableTreeData`) is a separate render path and the global proxy doesn't even pass `tag`; **type filter + badge are out of scope for global mode in v1** (the badge could be added there later). Note this in the plan.
- Only Java vs Bedrock are surfaced (the only two real editions in NexCraft). The badge keys off `config.type.includes("bedrock")` → Bedrock, `.includes("minecraft/java")` (or `minecraft` && not bedrock) → Java; non-Minecraft instances (shouldn't exist post-#18) get no badge/stripe.

## (B) Card badge + accent — `frontend/src/widgets/instance/Shortcut.vue`
- Add a computed edition: `instanceEdition = computed(() => { const ty = String(instanceInfo.value?.config?.type||""); return ty.includes("bedrock") ? "bedrock" : ty.includes("minecraft") ? "java" : ""; })`.
- **Badge:** in the status-tag row (the `<div class="mb-8 flex">` ~line 346, alongside the status `<a-tag>` and tag chips), add an `<a-tag>` showing `Java`/`Bedrock` with the edition color, `v-if="instanceEdition"`. Java → green-ish (custom class, NOT the status "green" to avoid implying "Running"); Bedrock → teal. Use scoped classes `.edition-java` / `.edition-bedrock`.
- **Accent stripe:** add an `:class="['instance-edition-' + instanceEdition]"` (or bind a class) to the `CardPanel` root, and a scoped `::before` left stripe (4px) colored per edition. (Confirm CardPanel passes through a class/style to its root; if not, wrap or use an absolutely-positioned stripe div inside the card body's container — the card root already has `position: relative`.)
- Colors (scoped CSS vars): Java `#6cba3a`, Bedrock `#2bb3a3`. Distinct from the status-green tag.

## (C) Type filter — daemon + panel + frontend
### Daemon — `daemon/src/routers/Instance_router.ts` (`instance/select` handler)
In the `queryWrapper.select(...)` filter closure, after the tag filter and before `return true`, add a type filter:
```typescript
// TYPE FILTER (edition): condition.type is "java" | "bedrock" | "" 
if (condition.type) {
  const ty = String(v.config.type || "");
  const isBedrock = ty.includes("bedrock");
  if (condition.type === "bedrock" && !isBedrock) return false;
  if (condition.type === "java" && (isBedrock || !ty.includes("minecraft"))) return false;
}
```
(`condition.type` arrives from the panel; empty/undefined = no filter.)

### Panel — `panel/src/app/routers/daemon_router.ts`
In the single-daemon `/remote_service_instances` handler: read `const type = ctx.query.type ? String(ctx.query.type) : undefined;` and add `type` into the `condition` object sent to `instance/select`. (Global handler: leave as-is — type filter is single-node scope for v1.) Add `type` to the route's `validator` query allowances if the validator is strict (optional string).

### Frontend API — `frontend/src/services/apis/index.ts`
Add `type?: string;` to the `remoteInstances` params type.

### Frontend UI — `frontend/src/widgets/InstanceList.vue`
- Add `type: ""` to `operationForm`.
- Pass `type: operationForm.value.type` in the `getInstances({ params })` call (single-node path only — the global path doesn't take it).
- Add a filter control in the toolbar next to the status select: a 3-option segmented or `<a-select>` (All / Java / Bedrock) bound to `operationForm.type`, calling `handleQueryInstance` (the existing throttled refetch) on change. Reset `currentPage` to 1 on change (mirror how status filtering behaves).
- i18n: `TXT_CODE_filter_all_types` = "All", `TXT_CODE_filter_java` = "Java", `TXT_CODE_filter_bedrock` = "Bedrock" (or reuse existing All key + plain "Java"/"Bedrock").

## i18n (en_US.json)
- `TXT_CODE_edition_java` = "Java", `TXT_CODE_edition_bedrock` = "Bedrock" (badge + filter labels can share these). A filter "All" can reuse the existing all-status "All" key (`TXT_CODE_c48f6f64`) or a new `TXT_CODE_filter_all_types`.

## Edge cases
- Non-Minecraft / unknown type → no badge, no stripe, not matched by Java or Bedrock filters (only matched by "All").
- Global daemon mode → no type filter control shown (or shown but no-op); v1 keeps badge/filter to single-node. Plan should hide the filter control when `isGlobalDaemonMode`.
- Switching type filter resets to page 1 (so you don't land on an out-of-range page).
- The badge must not be confused with the green "Running" status — use distinct edition colors.

## Verification
1. `npm run build --prefix daemon` · `--prefix panel` · `npm run type-check --prefix frontend` — clean; en_US valid.
2. Manual (Test stack, single node): cards show a Java badge + green stripe / Bedrock badge + teal stripe matching each instance's type. The toolbar filter All/Java/Bedrock narrows the list (and works across pages — add enough instances or set page size low to confirm it filters server-side, not just the page). Filter resets to page 1. Global-daemon view unaffected (no errors; filter hidden or no-op).
