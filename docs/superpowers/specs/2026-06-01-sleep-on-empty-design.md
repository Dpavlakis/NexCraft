# Sleep-on-Empty / Wake-on-Join (#16) — Design

**Status:** Approved 2026-06-01 (brainstorm complete). Ready for `writing-plans` → subagent-driven execution **after #14 ships** (both share the new Automation tab; build #14 first).
Branch: `test`.

## Goal
Save host resources by automatically **stopping** an idle Minecraft server (0 players for N minutes), and **waking** it when a player tries to connect — so the server only runs when someone's actually playing. Lives in the same **Automation** tab in Instance Settings as #14.

## Two independent halves
1. **Sleep-on-empty** — works for Java AND Bedrock (just watches the already-polled player count). Always available when enabled.
2. **Wake-on-join** — a daemon TCP listener that answers a Minecraft Server List Ping while the server is asleep and triggers a start. **Java Edition only in v1** (Java SLP over TCP). Bedrock wake (UDP unconnected-ping) is deferred to a follow-up; sleep-on-empty still works for Bedrock without wake.

## Config — `daemon/src/entity/instance/Instance_config.ts`
```typescript
sleepOnEmpty = {
  enabled: false,
  idleTimeoutMinutes: 10,     // 0 players this long -> stop
  wakeOnJoin: true,           // open the wake listener while asleep (Java only)
  wakeMotd: "Server is waking up... reconnect in a moment"
};
```
Persisted via the existing `StorageSubsystem.store("InstanceConfig", ...)`.

## Half 1 — Sleep-on-empty (daemon lifecycle task)
New lifecycle task `SleepOnEmptyTask` (modeled on `PingMinecraftServerTask` in `daemon/src/entity/commands/task/mc_players.ts`), registered when an instance starts IF `sleepOnEmpty.enabled`:
- Player count is already refreshed every 10s into `instance.info.currentPlayers` by the existing ping task — reuse it; do NOT add a second poller. `SleepOnEmptyTask` runs its own lighter interval (e.g. every 30s) that reads `instance.info.currentPlayers`.
- State machine: track `emptySince: number | null`.
  - If `currentPlayers > 0` → `emptySince = null`.
  - If `currentPlayers === 0` and `emptySince === null` → `emptySince = Date.now()`.
  - If `currentPlayers === 0` and `Date.now() - emptySince >= idleTimeoutMinutes*60_000` → print a console line ("Idle N min, no players — sleeping") and `instance.execPreset("stop")`. The task is torn down on stop (lifecycle), so no double-fire.
- Guard: only act when `instance.status() === RUNNING` (ignore STARTING/STOPPING). Ignore the very first ping cycle until at least one real count has been observed (avoid stopping during a slow boot where the ping hasn't populated yet — require `instance.info.mcPingOnline === true` before counting empties).
- Registered/unregistered via the existing `lifeCycleTaskManager` (register on start, auto-clears on stop).

## Half 2 — Wake-on-join (daemon TCP listener, Java only)
New service `daemon/src/service/wake_listener_service.ts` (singleton, per-instance listeners):
- **When to open:** when an instance transitions to STOPPED *and* `sleepOnEmpty.enabled && wakeOnJoin && type is Java`. Open a `net.createServer()` bound to the instance's Minecraft port (resolve from `instance.config.pingConfig.port`, falling back to reading `server-port` from server.properties / `basePort`).
  - If the port can't be bound (already in use, e.g. server still releasing it) → retry a few times with backoff; if it ultimately fails, log and give up (no crash).
- **On a client connection:** speak just enough Minecraft SLP to be friendly:
  - Read the client's Handshake + Status Request packets (VarInt-length-prefixed; next-state 1 = status). Implement a minimal VarInt reader.
  - Respond with a **Status Response** JSON: `{ version: { name: "Sleeping", protocol: <echo client's or a low number> }, players: { max: 0, online: 0 }, description: { text: <wakeMotd> } }`, then handle the optional Ping/Pong, then close.
  - If the client's next-state is 2 (login, i.e. they clicked "join" not just refreshed): respond with a **Login Disconnect** packet carrying `wakeMotd` (so the player sees the wake message as the kick reason), then close.
  - On ANY connection (status or login), trigger the wake: `instance.execPreset("start")` (debounced — only fire once per sleep period; ignore further connections while STARTING).
- **When to close the listener:** as soon as the instance reaches STARTING/RUNNING (the real server needs the port). Close the `net.Server`, free the port, done. If start fails and it returns to STOPPED, re-open the listener.
- **Robustness:** wrap all socket parsing in try/catch (malformed/port-scanner traffic must not crash the daemon); cap read size; per-socket timeout (e.g. 5s) so half-open sockets are dropped.

A minimal, well-contained SLP module (`wake_slp.ts` or inline) handles VarInt + the 2-3 packet types — no full protocol proxy, no login handshake beyond the disconnect.

## Lifecycle wiring
- On daemon boot / instance load: if an instance is STOPPED and wake-on-join applies, open its listener. (Hook the same init path #14 uses.)
- On instance STOP (lifecycle hook, after status → STOPPED): open the wake listener (if applicable).
- On instance START (status → STARTING): close the wake listener.
- On config save: re-evaluate (open/close listener, register/unregister sleep task as needed) — a `wakeListenerService.applyForInstance(instance)` + `sleep task re-eval`, called from the same config-update hook #14 adds.
- On instance delete: close listener, clear task.

## Frontend — Automation tab (extend what #14 created)
Add a **Sleep-on-Empty** section below #14's Scheduled Restart section in the Automation tab:
- **Enable** switch (`config.sleepOnEmpty.enabled`).
- When enabled:
  - **Idle timeout (minutes)** number input (default 10, min 1).
  - **Wake on join** switch (default on) with a note: "Java Edition only — opens a listener on the server port while asleep so a connection attempt restarts it."
  - **Wake message** text input (`wakeMotd`) shown to players while the server is waking.
  - For Bedrock instances: show the wake-on-join switch disabled with a "Bedrock wake coming later — sleep still works" note (sleep-on-empty applies; wake doesn't yet).
- Saves with the existing config Save flow; daemon re-applies on save.

i18n keys under `TXT_CODE_sleep_*` in en_US.json.

## Edge cases / risks
- **Port handoff race:** the real server must be able to bind the port right after the listener closes. Close the listener the instant status → STARTING (before the server process binds). If the server fails to bind because the listener lingered, that's the bug to watch in testing.
- **Slow boot false-sleep:** require `mcPingOnline === true` before counting empty cycles, so a server mid-generation isn't stopped.
- **Wake storm:** debounce — one `start` per sleep period; ignore connections once STARTING.
- **Manual control wins:** if an admin manually stops a server, sleep-on-empty is moot (already stopped); if they manually start, the listener closes normally. Don't auto-sleep a server the admin just started until it's seen players? — Keep simple: the idle timer starts fresh on each start; a server no one joins will sleep after the timeout (acceptable and arguably desirable). Document this.
- **Port scanners / monitoring pings** hitting the wake port would wake the server. Acceptable for v1 (home use); note it. (A future option: only wake on a login-state connection, not a status ping.)
- Bedrock: no listener opened; sleep-on-empty still functions.

## Out of scope (v1)
- Bedrock wake-on-join (UDP) — deferred.
- Full connection proxy / zero-retry seamless join (we do fake-MOTD + disconnect; player reconnects).
- "Wake only on real join, not status ping" toggle — possible future refinement.

## Verification
1. Builds clean (daemon/panel/frontend); en_US.json valid.
2. Manual (Test stack), Java: enable Sleep-on-Empty (idle 1 min for testing) + wake-on-join on a running server with 0 players → after ~1 min it logs "sleeping" and stops. While stopped, add the server in a Minecraft client → the server list shows the wake MOTD; the daemon starts the instance; reconnect a few seconds later → join succeeds; listener closed (real server on the port).
3. Join the server, then leave → idle timer resets while present, counts after you leave.
4. Bedrock: sleep-on-empty stops an idle server; wake-on-join switch shown disabled with the note.
5. Daemon restart while an instance is asleep → listener re-opens; wake still works.
6. Manual start of a sleeping instance from the panel → listener closes cleanly, no port conflict.
