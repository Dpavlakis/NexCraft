# Bedrock Player Management — design

**Date:** 2026-06-01
**Branch:** `test`
**Status:** approved (brainstorm) → planning next

## Problem

The Players card and the entire daemon player service are **RCON-only**
(`daemon/src/service/mc_player_service.ts` — `list`/`kick`/`ban`/`op` all go over
RCON). Bedrock Dedicated Server (BDS) has **no RCON protocol at all** (RCON is a
Java-Edition / Source-engine feature). So on a Bedrock instance the Players card
shows a misleading "RCON is not enabled… enable in `server.properties`" message —
yet those keys don't exist on Bedrock and adding them does nothing.

This feature adds **native Bedrock player management** driven by the server's
**console (stdin/stdout)** instead of RCON, and makes the existing Players card
edition-aware so Bedrock instances get a real card instead of the broken message.

## Goals

- Manage Bedrock players from the panel: see who's online, kick, manage the
  allowlist (add/remove/toggle), and grant/revoke operator.
- Reuse the single **Players** Manage-grid button (edition-aware), which removes
  the misleading RCON message as a side effect.
- Keep the Java/RCON path completely untouched; isolate Bedrock logic so its
  parsers are unit-testable.

## Non-goals

- **Bans.** BDS has no native persistent ban system. The de-facto "ban" is
  *remove from allowlist + allowlist on*; we expose those primitives rather than
  inventing a ban store.
- No Java behaviour changes; no new Manage-grid button.
- No attempt to suppress the polled `list` echo from the web console this round
  (see Open questions / future).

## Decisions (from brainstorm)

- **Refresh:** auto-poll every ~15s (parity with the Java card), plus manual
  Refresh. Accepted tradeoff: each `list` is injected into the live server
  console and appears in the terminal/logs (RCON is silent; the console is not).
- **Capabilities:** online list + kick; allowlist add/remove + on/off toggle;
  operators op/deop; show the **full offline allowlist roster** (not just online).
- **Grid button:** a **single "Players" button** that adapts to edition
  (Approach 1). No separate Bedrock button.

## Architecture

Mirrors the existing Java player feature end-to-end, with a parallel,
console-driven backend path.

### Daemon — `daemon/src/service/bedrock_player_service.ts` (new)

Console helper (best-effort capture):

```
async function runConsole(instance, command, settleMs = 1000): Promise<string>
  - if instance.status() !== Instance.STATUS_RUNNING -> throw "server must be running"
  - chunks = []; listener = (text) => chunks.push(String(text))
  - instance.on("data", listener)
  - try { await instance.execPreset("command", command); await sleep(settleMs) }
    finally { instance.removeListener("data", listener) }
  - return chunks.join("")
```

`instance.execPreset("command", text)` resolves (for a non-RCON Bedrock instance)
to `GeneralSendCommand`, which writes the line to the process stdin. The instance
emits decoded console text on its `"data"` event, so a temporary listener
captures the response.

Operations:

- **Online:** `runConsole(instance, "list")` → `parseBedrockList(text)`.
  BDS format: `There are N/M players online:` followed (next line) by a
  comma-separated list of gamertags. Parser tolerates the count line and the
  names line; returns `string[]`.
- **Kick:** `kick "<name>"` (optionally a reason later).
- **Allowlist:**
  - roster: read `allowlist.json` (`{ ignoresPlayerLimit?, name, xuid }[]`) →
    `{ name, xuid }[]`. Missing file → `[]`.
  - add/remove: `allowlist add "<name>"` / `allowlist remove "<name>"`.
  - toggle: `allowlist on` / `allowlist off`.
  - enabled-state: read `server.properties` key `allow-list` (fallback
    `white-list`) via the existing `getServerProperty` helper in `mc_motd.ts`.
- **Operators:**
  - current: read `permissions.json` (`{ permission, xuid }[]`); keep entries
    whose `permission === "operator"`. Resolve a display `name` by cross-
    referencing `allowlist.json` XUID→name where possible (online `list` gives
    names only, no XUID, so unresolved ops show XUID).
  - op/deop: `op "<name>"` / `deop "<name>"` (BDS resolves by gamertag; the
    player generally must be online or otherwise known to the server).

Validation / injection safety (`assertValidName`):

- Trim; require length 1–32; reject any string containing `\r`, `\n`, or `"`.
  (Bedrock gamertags may contain spaces, so we allow spaces but always **quote**
  the name in the command and forbid embedded quotes/newlines.)

Overview function:

```
getBedrockOverview(instance) => {
  running:          boolean,                 // status() === STATUS_RUNNING
  online:           string[],                // [] when stopped / capture miss
  allowlist:        { name: string, xuid?: string }[],   // from allowlist.json
  allowlistEnabled: boolean,                 // from server.properties allow-list
  operators:        { name?: string, xuid: string }[]    // from permissions.json
}
```

Files are read from disk via `instance.absoluteCwdPath()`, so `allowlist`,
`operators`, and `allowlistEnabled` display even when the server is **stopped**;
only `online` and console actions require RUNNING.

Action function:

```
bedrockPlayerAction(instance, action, name?) where action in:
  "kick" | "allowlist_add" | "allowlist_remove" |
  "allowlist_on" | "allowlist_off" | "op" | "deop"
```

`allowlist_on`/`allowlist_off` take no name; the rest require a valid name.

### Daemon router — `daemon/src/routers/player_router.ts` (extend)

Two new events, same shape as `player/list` / `player/action`:

- `player/bedrock_overview` → `getBedrockOverview(instance)`
- `player/bedrock_action` → `bedrockPlayerAction(instance, data.action, data.name)`

(Already imported in `daemon/src/service/router.ts`; no new import needed.)

### Panel router — `panel/src/app/routers/player_router.ts` (extend)

Reuse the existing `/protected_player` router (ownership middleware + `ROLE.USER`):

- `GET  /protected_player/bedrock_overview` → `request("player/bedrock_overview", { instanceUuid })`
- `POST /protected_player/bedrock_action`   → `request("player/bedrock_action", { instanceUuid, action, name })`

### Frontend

- `frontend/src/services/apis/player.ts`: add `bedrockPlayerOverview` (GET) and
  `bedrockPlayerAction` (POST) with a `BedrockPlayerOverview` type matching the
  daemon shape.
- **`frontend/src/widgets/instance/BedrockPlayers.vue`** (new):
  - **Allowlist on/off** switch (confirm on change).
  - **Online** panel: each online gamertag with a generic icon (no mc-heads
    skin), actions: **Kick**, **Op/Deop**, **Add to / Remove from allowlist**.
  - **Allowlist roster** panel: full list from `allowlist.json` with **Remove**,
    plus an input + **Add** to allowlist a gamertag; operator entries tagged.
  - Auto-poll 15s; manual Refresh; "server offline" info alert when not running.
  - Hides Return button + title in the manage modal via
    `inject("embeddedInManageModal", false)` (per project convention).
- **`frontend/src/widgets/instance/Players.vue`**: branch on edition — if
  `instanceInfo.config.type.includes("bedrock")` render `<BedrockPlayers/>`,
  else the existing Java UI. (Implementation may extract the current Java markup
  into the branch or keep Players.vue as a thin switch; keep files focused.)
- `ManagerBtns.vue`: **unchanged** — the single Players button now opens the
  correct edition variant.

## Data shapes / command reference

| Need              | Source / command                                              |
| ----------------- | ------------------------------------------------------------- |
| Online players    | console `list` → parse "players online:" + names line         |
| Kick              | console `kick "<name>"`                                        |
| Allowlist roster  | read `allowlist.json` (`{name,xuid}[]`)                        |
| Allowlist add/rm  | console `allowlist add\|remove "<name>"`                       |
| Allowlist on/off  | console `allowlist on\|off`; state ← `server.properties allow-list` |
| Operators         | read `permissions.json` (`operator` XUIDs), name ← allowlist   |
| Op / Deop         | console `op\|deop "<name>"`                                    |

## Error handling / edge cases

- **Server stopped:** overview returns `running:false`, `online:[]`, but still
  reads roster/operators/toggle from disk. Console actions throw a clear
  "server must be running" error surfaced to the UI.
- **Missing `allowlist.json` / `permissions.json`:** treated as empty.
- **`list` capture miss / slow server:** `online` is `[]` (best-effort, matches
  the Java card's swallow-and-empty behaviour).
- **Names with spaces:** quoted in commands; embedded `"`/newlines rejected.
- **op/deop of an unknown player:** BDS may reject in-console; the action is
  fire-and-forget and the card refreshes after — no hard failure in the panel.
- **Console pollution:** accepted for this round (15s poll). See future work.

## Testing strategy

- **Unit (pure functions, no server):**
  - `parseBedrockList` against sample BDS outputs (0 players, N players, odd
    spacing).
  - `allowlist.json` reader (present / missing / malformed).
  - operator XUID→name cross-ref (resolvable + unresolved XUID).
  - `assertValidName` (spaces ok; reject newline / quote / overlong / empty).
- **Manual (Test stack, real Bedrock instance):** online list + kick; allowlist
  add/remove and on/off toggle; op/deop; offline roster/operators still render
  with the server stopped; verify the old RCON message is gone.

## Future / open

- Optionally **filter the polled `list` command + its output** from the pushed
  web-console stream so the terminal stays clean despite 15s polling (fragile to
  identify reliably; deferred).
- Kick **reason** field.
- Resolve operator names more completely via an XUID→name cache built from
  observed joins.

## Affected files

- New: `daemon/src/service/bedrock_player_service.ts`,
  `frontend/src/widgets/instance/BedrockPlayers.vue`.
- Edit: `daemon/src/routers/player_router.ts`,
  `panel/src/app/routers/player_router.ts`,
  `frontend/src/services/apis/player.ts`,
  `frontend/src/widgets/instance/Players.vue`,
  `languages/en_US.json` (new i18n keys).
