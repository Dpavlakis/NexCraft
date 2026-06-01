# Bedrock Minecraft Settings (Server Name / Level Name / Icon) — Design

**Status:** Approved 2026-05-31. Ready for `writing-plans` → subagent-driven execution.
Branch: `test`.

## Goal
The instance-settings "Minecraft" tab is currently Java-only (MOTD + Server Icon). Give **Bedrock** an equivalent tab so an admin can set:
- **Server Name** (Bedrock's `server-name` — the equivalent of Java's MOTD, the name shown in the server list),
- **Level Name** (`level-name` — the active world folder under `worlds/<name>`),
- **Set Server Icon** (writes `server-icon.png` for the NexCraft UI glance / Basic Info — Bedrock has no in-game icon, but the file is still useful in the panel).

Java keeps its existing tab (MOTD + Icon). **Level Name is Bedrock-only** (not added to Java).

## Key Minecraft reality (drives the design)
- `level-name` is the pointer to the active world. Changing it to a name that doesn't exist on disk makes the server **generate a fresh empty world** on next start; the old world stays under its old folder name (not deleted, just inactive). → Level Name needs a clear caveat + a confirm-on-change.
- Java MOTD lives in `server.properties` as `motd=` (ISO-8859-1 / latin1, `&`→`§` colour codes) — already handled by `mc_motd.ts`.
- Bedrock `server.properties` is **plain UTF-8**, keys `server-name` and `level-name`, **no** `&` colour translation.
- Changes here are written to `server.properties` and take effect **on next (re)start** — no auto-restart. Show an "applies on next start" note (matches existing MOTD behavior).

## Frontend — `frontend/src/widgets/instance/dialogs/InstanceDetail.vue`
- Add `isMinecraftBedrock = computed(() => type?.startsWith("minecraft/bedrock"))`.
- Generalize the tab gate: `showMinecraftTab = !isTemplateMode && !isGlobalTerminal && (isMinecraftJava || isMinecraftBedrock)`. Keep the existing `showMotd` (Java-only) for the MOTD field's `v-if`.
- The Minecraft tab content:
  - **Java** (`v-if="isMinecraftJava"`): existing **MOTD** field (unchanged) + **Set Server Icon** (unchanged).
  - **Bedrock** (`v-if="isMinecraftBedrock"`): new **Server Name** input + new **Level Name** input (+ caveat caption + confirm-on-change) + **Set Server Icon** (reuse the existing `SetServerIcon` component/button).
- Load on open: for Bedrock, fetch current `server-name` + `level-name` via a new API (below). Keep `loadMotd()` for Java.
- Save (extend the existing save flow that already persists MOTD separately):
  - Java: existing MOTD save (unchanged).
  - Bedrock: if `server-name` changed → write it; if `level-name` changed → **confirm dialog** first, then write. Track `original*` values like MOTD does to detect changes.
  - Server Icon: unchanged (already its own dialog/flow; just make the button available on the Bedrock branch).

## Backend
### Daemon — extend `daemon/src/service/mc_motd.ts` (or a small sibling) with generic key get/set
- Add `getServerProperty(instance, key): string` and `setServerProperty(instance, key, value): void` that read/write a single `key=value` line in `server.properties`, **UTF-8** (Bedrock), without the `&`/`§` colour translation (that's MOTD/Java-specific). Reuse the same "only touch the one line, create file only if needed" approach as `setMotd`.
  - Implementation detail: parameterize a regex per key (`^<key>\s*=(.*)$/m`). Do NOT reuse the latin1 encoding for Bedrock — use UTF-8 read/write. Keep `getMotd`/`setMotd` exactly as-is for Java.
- Router action in `daemon/src/routers/Instance_router.ts` (next to the existing `instance/motd`): `instance/server_property` — `data: { instanceUuid, key, value? }`. If `value == null` → return current value; else write it. **Whitelist** allowed keys to `["server-name", "level-name"]` (reject anything else, so this can't be used to rewrite arbitrary properties).

### Panel — `panel/src/app/routers/instance_router.ts` (or wherever `instance/motd` is proxied)
- Add `getServerProperty` / `setServerProperty` proxy endpoints mirroring the existing MOTD proxy. Same permission level the MOTD proxy uses (admin / instance-config). Forward `{ instanceUuid, key, value? }` to daemon `instance/server_property`.

### Frontend API — `frontend/src/services/apis/instance.ts`
- Add `getServerProperty` / `setServerProperty` `useDefineApi` definitions mirroring `getInstanceMotd` / `setInstanceMotd`.

## i18n (en_US.json — source of truth)
- `TXT_CODE_bedrock_server_name` = "Server Name", `..._server_name_desc` = "The name shown in the server list. Saved to server.properties; applies on next start."
- `TXT_CODE_bedrock_level_name` = "Level Name", `..._level_name_desc` = "The active world folder (worlds/<name>). Saved to server.properties; applies on next start."
- `TXT_CODE_bedrock_level_name_warn` = "Changing the level name loads or creates a different world under worlds/<name>. Your current world stays on disk under its old name."
- `TXT_CODE_bedrock_level_name_confirm` = "Change the active world (level-name)? The server will load/generate worlds/<new-name> on next start; the current world is kept under its old name."
- Reuse existing icon/Save keys.

## Out of scope
- No `&`/`§` colour handling for Bedrock (Bedrock doesn't use Java colour codes in server-name).
- No Level Name on Java (deliberately — World Management / Configuration Files cover that; avoids a foot-gun on the common platform).
- No auto-restart (apply on next start).
- No multi-world switching UI (that's World Management's domain; this is just the single `level-name` value with a caveat).

## Verification
1. `npm run build --prefix daemon` · `npm run build --prefix panel` · `npm run type-check --prefix frontend` — clean.
2. Manual (Test stack), **Bedrock** instance → Instance Settings → Minecraft tab: set **Server Name** → Save → `server-name` updated in server.properties (UTF-8). Set **Server Icon** → `server-icon.png` written; shows in Basic Info. Change **Level Name** → confirm dialog appears → on confirm, `level-name` updated; on next start BDS loads `worlds/<new-name>` (fresh world if new), old world folder still present.
3. **Java** instance → Minecraft tab unchanged (MOTD + Icon still work, no Level Name field).
4. Daemon rejects `instance/server_property` for any key not in the whitelist.
