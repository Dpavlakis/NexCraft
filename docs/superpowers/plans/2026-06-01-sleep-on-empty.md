# Sleep-on-Empty / Wake-on-Join (#16) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Auto-stop an idle Minecraft server (0 players for N minutes) and auto-start it when a player connects, configured in the Automation tab (added by #14).

**Architecture:** (1) `SleepOnEmptyTask` — a per-instance lifecycle task (like `PingMinecraftServerTask`) watching `instance.info.currentPlayers`, stops after an idle timeout. Works Java + Bedrock. (2) `wake_listener_service.ts` — a daemon singleton that, while a Java instance is stopped (and wake-on-join enabled), runs a tiny TCP server on the instance's port that speaks just enough Minecraft SLP to show a "waking up" MOTD / disconnect message, then triggers `execPreset("start")` and frees the port. Config field `sleepOnEmpty` typed once in `common/global.d.ts`.

**Tech Stack:** TypeScript, Node `net`, Minecraft Java SLP (VarInt-framed packets), Vue 3 + Ant Design Vue.

---

## Conventions
- Gate = `npm run build --prefix daemon` / `--prefix panel` / `npm run type-check --prefix frontend` + `en_US.json` valid. PowerShell PATH prefix before npm/node:
  ```powershell
  $env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
  ```
- Branch `test` (checked out). Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Spec: `docs/superpowers/specs/2026-06-01-sleep-on-empty-design.md`.
- Config type is single-source: `common/global.d.ts` `IGlobalInstanceConfig`.
- **Depends on #14 being merged on `test`** (the Automation tab + `scheduledRestart` already exist; this adds a section + a config field next to them).

## File map
- Modify: `common/global.d.ts` — add `sleepOnEmpty` to `IGlobalInstanceConfig`.
- Modify: `daemon/src/entity/instance/Instance_config.ts` — default it.
- Modify: `frontend/src/types/const.ts` — `defaultInstanceInfo` default (required-field type).
- Create: `daemon/src/service/wake_slp.ts` — minimal Java SLP VarInt + response builders + handshake parser.
- Create: `daemon/src/service/wake_listener_service.ts` — the TCP wake-listener singleton.
- Create: `daemon/src/entity/commands/task/sleep_on_empty.ts` — the idle-stop lifecycle task.
- Modify: `daemon/src/entity/commands/dispatcher.ts` — register `SleepOnEmptyTask` for Minecraft instances.
- Modify: `daemon/src/service/system_instance.ts` — wire wake listener at boot.
- Modify: `daemon/src/entity/instance/instance.ts` — re-evaluate wake listener when config is applied.
- Modify: `frontend/src/widgets/instance/dialogs/InstanceDetail.vue` — Sleep-on-Empty section in the Automation tab.
- Modify: `languages/en_US.json` — i18n.

---

## Task 1: Config field (type + daemon default + frontend default)

**Files:** `common/global.d.ts`, `daemon/src/entity/instance/Instance_config.ts`, `frontend/src/types/const.ts`

- [ ] **Step 1: Type in `common/global.d.ts`**

In `IGlobalInstanceConfig`, immediately after the `scheduledRestart: { ... };` block (added by #14), add:
```typescript
  sleepOnEmpty: {
    enabled: boolean;
    idleTimeoutMinutes: number;
    wakeOnJoin: boolean;
    wakeMotd: string;
  };
```

- [ ] **Step 2: Default in daemon `Instance_config.ts`**

Immediately after the `public scheduledRestart = { ... };` block, add:
```typescript
  // Sleep-on-empty + wake-on-join (#16)
  public sleepOnEmpty = {
    enabled: false,
    idleTimeoutMinutes: 10,
    wakeOnJoin: true,
    wakeMotd: "Server is waking up... reconnect in a moment"
  };
```

- [ ] **Step 3: Default in frontend `frontend/src/types/const.ts`**

In `defaultInstanceInfo` (the object that mirrors the config; #14 added `scheduledRestart` here), add a sibling after `scheduledRestart`:
```typescript
    sleepOnEmpty: {
      enabled: false,
      idleTimeoutMinutes: 10,
      wakeOnJoin: true,
      wakeMotd: "Server is waking up... reconnect in a moment"
    },
```
(READ the file first to match the exact object/indentation; place it next to the `scheduledRestart` default.)

- [ ] **Step 4: Build daemon + type-check frontend**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
npm run type-check --prefix frontend
```
Expected: both clean (the `implements`/type constraints force all three to agree).

- [ ] **Step 5: Commit**
```powershell
git add common/global.d.ts daemon/src/entity/instance/Instance_config.ts frontend/src/types/const.ts
git commit -m @'
feat(#16): sleepOnEmpty config field (type + daemon + frontend defaults)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 2: Minimal Java SLP protocol module

**Files:** Create `daemon/src/service/wake_slp.ts`

This is net-new (no existing VarInt/SLP in the daemon). It provides: VarInt read/write, a status-response builder, a login-disconnect builder, and a handshake parser. Pure functions, no I/O — easy to reason about.

- [ ] **Step 1: Create the file**

```typescript
// Minimal Minecraft Java "Server List Ping" (SLP) helpers for the wake listener.
// We only need to: parse a client Handshake (to read next-state + protocol),
// answer a Status Request with a JSON status, and answer a Login Start with a
// disconnect message. Packets are VarInt-length-framed. No full protocol/proxy.

export function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0; // treat as unsigned 32-bit
  do {
    let temp = v & 0b0111_1111;
    v >>>= 7;
    if (v !== 0) temp |= 0b1000_0000;
    bytes.push(temp);
  } while (v !== 0);
  return Buffer.from(bytes);
}

// Read a VarInt at `offset`. Returns null if the buffer doesn't yet hold a full
// VarInt (caller should wait for more data). Throws if it exceeds 5 bytes.
export function readVarInt(
  buf: Buffer,
  offset: number
): { value: number; size: number } | null {
  let numRead = 0;
  let result = 0;
  let read: number;
  do {
    if (offset + numRead >= buf.length) return null; // incomplete
    read = buf[offset + numRead];
    result |= (read & 0x7f) << (7 * numRead);
    numRead++;
    if (numRead > 5) throw new Error("VarInt too big");
  } while ((read & 0x80) !== 0);
  return { value: result >>> 0, size: numRead };
}

export interface ParsedHandshake {
  nextState: number; // 1 = status, 2 = login
  protocolVersion: number;
  totalConsumed: number; // bytes consumed for the whole handshake packet
}

// Try to parse a Handshake packet from the start of `buf`. Returns null if the
// buffer doesn't yet contain a complete handshake (wait for more data).
// Handshake = len:VarInt, id:VarInt(0x00), protocol:VarInt, addr:String, port:u16, nextState:VarInt
export function parseHandshake(buf: Buffer): ParsedHandshake | null {
  const lenField = readVarInt(buf, 0);
  if (!lenField) return null;
  const packetLen = lenField.value;
  const headerSize = lenField.size;
  if (buf.length < headerSize + packetLen) return null; // full packet not arrived
  let p = headerSize;
  const id = readVarInt(buf, p);
  if (!id) return null;
  p += id.size;
  if (id.value !== 0x00) {
    // Not a handshake (could be a legacy 0xFE ping). Signal "consume all" so the
    // caller still wakes + closes.
    return { nextState: 1, protocolVersion: 0, totalConsumed: headerSize + packetLen };
  }
  const proto = readVarInt(buf, p);
  if (!proto) return null;
  p += proto.size;
  const addrLen = readVarInt(buf, p);
  if (!addrLen) return null;
  p += addrLen.size + addrLen.value; // skip the server-address string
  p += 2; // skip the u16 port
  const nextState = readVarInt(buf, p);
  if (!nextState) return null;
  return {
    nextState: nextState.value,
    protocolVersion: proto.value,
    totalConsumed: headerSize + packetLen
  };
}

// Build a Status Response packet (id 0x00 in status state) carrying the JSON.
export function buildStatusResponse(opts: {
  motd: string;
  protocol: number;
  versionName?: string;
}): Buffer {
  const json = JSON.stringify({
    version: { name: opts.versionName ?? "Sleeping", protocol: opts.protocol || 0 },
    players: { max: 0, online: 0, sample: [] },
    description: { text: opts.motd }
  });
  const jsonBuf = Buffer.from(json, "utf8");
  const body = Buffer.concat([writeVarInt(0x00), writeVarInt(jsonBuf.length), jsonBuf]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

// Build a Login Disconnect packet (id 0x00 in login state) carrying a chat JSON.
export function buildLoginDisconnect(motd: string): Buffer {
  const json = JSON.stringify({ text: motd });
  const jsonBuf = Buffer.from(json, "utf8");
  const body = Buffer.concat([writeVarInt(0x00), writeVarInt(jsonBuf.length), jsonBuf]);
  return Buffer.concat([writeVarInt(body.length), body]);
}
```

- [ ] **Step 2: Build daemon**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
```
Expected: compiles.

- [ ] **Step 3: Commit**
```powershell
git add daemon/src/service/wake_slp.ts
git commit -m @'
feat(#16): minimal Java SLP helpers for the wake listener (VarInt + status/disconnect)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 3: Wake-listener service

**Files:** Create `daemon/src/service/wake_listener_service.ts`

Per-instance TCP listener that wakes a sleeping Java server. Wires `open`/`exit` events ONCE per instance, then opens/closes the listener based on current status + config.

- [ ] **Step 1: Create the file**

```typescript
import net from "net";
import fs from "fs-extra";
import path from "path";
import Instance from "../entity/instance/instance";
import logger from "./log";
import { buildLoginDisconnect, buildStatusResponse, parseHandshake } from "./wake_slp";

function isJava(instance: Instance): boolean {
  return String(instance.config?.type || "").includes("java");
}

// Resolve the Java server's TCP port: prefer pingConfig.port, else server.properties.
function resolvePort(instance: Instance): number {
  const p = Number(instance.config?.pingConfig?.port);
  if (p && p > 0) return p;
  try {
    const file = path.join(instance.absoluteCwdPath(), "server.properties");
    if (fs.existsSync(file)) {
      const txt = fs.readFileSync(file, "utf-8");
      const m = txt.match(/^server-port\s*=\s*(\d+)/m);
      if (m) return Number(m[1]);
    }
  } catch {
    // ignore
  }
  return 25565;
}

class WakeListenerService {
  private servers = new Map<string, net.Server>();
  private wired = new Set<string>();
  private waking = new Set<string>();

  // Wire lifecycle hooks once, then evaluate current state.
  public applyForInstance(instance: Instance) {
    const uuid = instance.instanceUuid;
    if (!this.wired.has(uuid)) {
      this.wired.add(uuid);
      // When the server starts, free the port for the real server.
      instance.on("open", () => this.closeListener(uuid));
      // When the server stops, (re)open the wake listener if applicable.
      instance.on("exit", () => {
        this.waking.delete(uuid);
        this.evaluate(instance);
      });
    }
    this.evaluate(instance);
  }

  // Open or close the listener to match current status + config.
  private evaluate(instance: Instance) {
    const uuid = instance.instanceUuid;
    const cfg = instance.config?.sleepOnEmpty;
    const shouldListen =
      !!cfg &&
      cfg.enabled &&
      cfg.wakeOnJoin &&
      isJava(instance) &&
      instance.status() === Instance.STATUS_STOP;
    if (shouldListen) {
      this.openListener(instance);
    } else {
      this.closeListener(uuid);
    }
  }

  private openListener(instance: Instance, attempt = 0) {
    const uuid = instance.instanceUuid;
    if (this.servers.has(uuid)) return; // already open
    const port = resolvePort(instance);

    const server = net.createServer((socket) => {
      socket.setTimeout(5000, () => socket.destroy());
      let buf = Buffer.alloc(0);
      let handled = false;
      socket.on("data", (chunk) => {
        try {
          buf = Buffer.concat([buf, chunk]);
          if (buf.length > 4096) {
            socket.destroy();
            return;
          }
          if (handled) return;
          const hs = parseHandshake(buf);
          if (!hs) return; // wait for more
          handled = true;
          const motd = instance.config?.sleepOnEmpty?.wakeMotd || "Server is waking up...";
          if (hs.nextState === 2) {
            // Login attempt -> send a disconnect carrying the wake message.
            socket.write(buildLoginDisconnect(motd));
          } else {
            // Status ping -> respond with a "Sleeping" status showing the MOTD.
            socket.write(buildStatusResponse({ motd, protocol: hs.protocolVersion }));
          }
          // Wake regardless of state, then free the port and close.
          this.triggerWake(instance);
          socket.end();
        } catch (e: any) {
          socket.destroy();
        }
      });
      socket.on("error", () => socket.destroy());
    });

    server.on("error", (err: any) => {
      // Port likely still releasing from the previous run; retry a few times.
      this.servers.delete(uuid);
      if (attempt < 5 && instance.status() === Instance.STATUS_STOP) {
        setTimeout(() => this.openListener(instance, attempt + 1), 1000);
      } else {
        logger.warn(`[wake] ${uuid} listener bind failed on :${port}: ${err?.message ?? err}`);
      }
    });

    server.listen(port, () => {
      logger.info(`[wake] ${uuid} listening on :${port} (asleep)`);
    });
    this.servers.set(uuid, server);
  }

  private triggerWake(instance: Instance) {
    const uuid = instance.instanceUuid;
    if (this.waking.has(uuid)) return;
    this.waking.add(uuid);
    logger.info(`[wake] ${uuid} connection received — waking`);
    // Free the port FIRST so the real server can bind, then start.
    this.closeListener(uuid);
    instance.execPreset("start").catch((e) => {
      logger.error(`[wake] ${uuid} start failed: ${e?.message ?? e}`);
      this.waking.delete(uuid);
      // start failed -> instance stays STOPPED; reopen to catch the next attempt.
      this.evaluate(instance);
    });
  }

  public closeListener(uuid: string) {
    const s = this.servers.get(uuid);
    if (s) {
      try {
        s.close();
      } catch {}
      this.servers.delete(uuid);
    }
  }
}

export default new WakeListenerService();
```

- [ ] **Step 2: Build daemon**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
```
Expected: compiles. (`fs-extra`, `net`, `path` are available — `fs-extra` is used across the daemon. `logger` from `./log`. If the circular `Instance` import is an issue like in #14, it builds fine there, so it will here.)

- [ ] **Step 3: Commit**
```powershell
git add daemon/src/service/wake_listener_service.ts
git commit -m @'
feat(#16): wake-listener service (TCP SLP responder that starts a sleeping Java server)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 4: Sleep-on-empty lifecycle task + registration

**Files:** Create `daemon/src/entity/commands/task/sleep_on_empty.ts`, modify `daemon/src/entity/commands/dispatcher.ts`

- [ ] **Step 1: Create the task**

```typescript
import { ILifeCycleTask } from "../../instance/life_cycle";
import Instance from "../../instance/instance";
import logger from "../../../service/log";

// Auto-stops the instance after it has had 0 players for the configured idle
// timeout. Reads instance.info.currentPlayers (refreshed every 10s by the ping
// task). Works for Java and Bedrock. Registered for all Minecraft instances; a
// no-op unless sleepOnEmpty.enabled.
export default class SleepOnEmptyTask implements ILifeCycleTask {
  public status: number = 0;
  public name: string = "SleepOnEmpty";

  private task?: NodeJS.Timeout;
  private emptySince: number | null = null;
  private seenOnline = false;

  async start(instance: Instance) {
    this.emptySince = null;
    this.seenOnline = false;
    this.task = setInterval(() => {
      try {
        this.tick(instance);
      } catch (e: any) {
        logger.warn(`[sleep] ${instance.instanceUuid} tick error: ${e?.message ?? e}`);
      }
    }, 1000 * 30);
  }

  private tick(instance: Instance) {
    const cfg = instance.config?.sleepOnEmpty;
    if (!cfg || !cfg.enabled) {
      this.emptySince = null;
      return;
    }
    if (instance.status() !== Instance.STATUS_RUNNING) return;
    // Don't count empties until the server's ping has actually come online once,
    // so a slow boot (ping not yet populated) isn't mistaken for "empty".
    if (!instance.info.mcPingOnline) return;
    this.seenOnline = true;

    const players = Number(instance.info.currentPlayers) || 0;
    if (players > 0) {
      this.emptySince = null;
      return;
    }
    if (this.emptySince === null) {
      this.emptySince = Date.now();
      return;
    }
    const idleMs = Math.max(1, Number(cfg.idleTimeoutMinutes) || 0) * 60_000;
    if (Date.now() - this.emptySince >= idleMs) {
      logger.info(
        `[sleep] ${instance.instanceUuid} idle ${cfg.idleTimeoutMinutes} min, 0 players — sleeping`
      );
      instance.println("INFO", `Sleeping: no players for ${cfg.idleTimeoutMinutes} minute(s).`);
      this.emptySince = null;
      instance.execPreset("stop").catch((e) => {
        logger.error(`[sleep] ${instance.instanceUuid} stop failed: ${e?.message ?? e}`);
      });
    }
  }

  async stop(_instance: Instance) {
    if (this.task) clearInterval(this.task);
    this.task = undefined;
    this.emptySince = null;
  }
}
```

- [ ] **Step 2: Register in `daemon/src/entity/commands/dispatcher.ts`**

READ the file around the Minecraft block (~lines 81-86) where `PingMinecraftServerTask` is registered for Java/MCDR. Add the import at the top with the other task imports:
```typescript
import SleepOnEmptyTask from "./task/sleep_on_empty";
```
Register the task for ALL Minecraft instances (Java + Bedrock — sleep works for both). Find where Minecraft type is detected. The existing Java block registers the ping task; add the sleep task there, and also ensure Bedrock instances get it. Simplest: right after the existing `if (java || mcdr) { ... registerLifeCycleTask(new PingMinecraftServerTask()); }` block, add:
```typescript
    if (
      instance.config.type.includes("minecraft/java") ||
      instance.config.type.includes("minecraft/bedrock")
    ) {
      instance.lifeCycleTaskManager.registerLifeCycleTask(new SleepOnEmptyTask());
    }
```
(Confirm the exact type-check style used nearby and match it. If Bedrock doesn't refresh `currentPlayers`/`mcPingOnline` the same way, the task simply never sleeps for Bedrock — acceptable; the spec says sleep works for both, and Bedrock ping populates `currentPlayers` via `mc_ping_bedrock.ts`. If review finds Bedrock doesn't set `mcPingOnline`, note it — the guard `if (!mcPingOnline) return` would prevent Bedrock sleep; in that case relax the guard to also accept `currentPlayers != null` after a grace period. Keep Java correct regardless.)

- [ ] **Step 3: Build daemon**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
```
Expected: compiles.

- [ ] **Step 4: Commit**
```powershell
git add daemon/src/entity/commands/task/sleep_on_empty.ts daemon/src/entity/commands/dispatcher.ts
git commit -m @'
feat(#16): SleepOnEmptyTask — auto-stop after idle timeout (registered for Minecraft)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 5: Wire the wake listener (boot + config-apply)

**Files:** `daemon/src/service/system_instance.ts`, `daemon/src/entity/instance/instance.ts`

- [ ] **Step 1: At boot, apply for each instance**

In `daemon/src/service/system_instance.ts loadInstances()`, the #14 line `scheduledRestartService.applyForInstance(instance);` exists after `this.addInstance(instance);`. Add the wake-listener import near the top:
```typescript
import wakeListenerService from "./wake_listener_service";
```
And right after the `scheduledRestartService.applyForInstance(instance);` line, add:
```typescript
      wakeListenerService.applyForInstance(instance);
```

- [ ] **Step 2: Apply `sleepOnEmpty` config in `parameters()` + re-evaluate listener**

In `daemon/src/entity/instance/instance.ts`, add the import with the other service imports:
```typescript
import wakeListenerService from "../../service/wake_listener_service";
```
In `parameters(cfg, persistence = true)`, after the `if (cfg.scheduledRestart) { ... }` block (added by #14), add:
```typescript
    if (cfg.sleepOnEmpty) {
      const so = this.config.sleepOnEmpty;
      const inSo = cfg.sleepOnEmpty;
      if (inSo.enabled != null) so.enabled = Boolean(inSo.enabled);
      if (inSo.idleTimeoutMinutes != null) so.idleTimeoutMinutes = Number(inSo.idleTimeoutMinutes);
      if (inSo.wakeOnJoin != null) so.wakeOnJoin = Boolean(inSo.wakeOnJoin);
      if (inSo.wakeMotd != null) so.wakeMotd = String(inSo.wakeMotd);
    }
```
Then, next to the existing `scheduledRestartService.applyForInstance(this);` call (after the persist block), add:
```typescript
    wakeListenerService.applyForInstance(this);
```

- [ ] **Step 3: Build daemon**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run build --prefix daemon
```
Expected: compiles (watch for circular import; #14's identical pattern built fine).

- [ ] **Step 4: Commit**
```powershell
git add daemon/src/service/system_instance.ts daemon/src/entity/instance/instance.ts
git commit -m @'
feat(#16): wire wake listener on boot + re-evaluate on config apply

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 6: i18n

**Files:** `languages/en_US.json`

- [ ] **Step 1: Add keys (near the #14 `TXT_CODE_sched_restart_*` keys)**
```json
  "TXT_CODE_sleep_title": "Sleep When Empty",
  "TXT_CODE_sleep_desc": "Automatically stop this server after it has had no players for a while, and (Java) wake it when someone connects.",
  "TXT_CODE_sleep_enable": "Enable sleep when empty",
  "TXT_CODE_sleep_idle": "Idle timeout (minutes)",
  "TXT_CODE_sleep_idle_hint": "Stop the server after this many minutes with zero players.",
  "TXT_CODE_sleep_wake": "Wake on join (Java only)",
  "TXT_CODE_sleep_wake_hint": "While asleep, listen on the server port so a connection attempt restarts the server. Java Edition only.",
  "TXT_CODE_sleep_wake_bedrock": "Wake on join isn't available for Bedrock yet — sleep still works.",
  "TXT_CODE_sleep_motd": "Wake message",
  "TXT_CODE_sleep_motd_hint": "Shown to players in the server list / on connect while the server is waking up.",
```

- [ ] **Step 2: Validate**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
node -e "JSON.parse(require('fs').readFileSync('languages/en_US.json','utf8')); console.log('OK')"
```
Expected: `OK`.

- [ ] **Step 3: Commit**
```powershell
git add languages/en_US.json
git commit -m @'
feat(#16): i18n for Sleep When Empty

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 7: Frontend — Sleep section in the Automation tab

**Files:** `frontend/src/widgets/instance/dialogs/InstanceDetail.vue`

READ the Automation tab-pane #14 added. Add a Sleep-on-Empty section below the Scheduled Restart `<a-form-item>` (inside the same Automation `<a-tab-pane>`). Also add a Bedrock detection computed if not already present.

- [ ] **Step 1: Confirm/add an `isBedrock` computed**

Grep the file for an existing bedrock check. If none, add near the other computeds:
```typescript
const isBedrockInstance = computed(() =>
  String(formData.value.instance?.config?.type || "").includes("bedrock")
);
```
(If a similar computed already exists — e.g. `isMinecraftBedrock` from the Bedrock Minecraft-settings work — reuse it instead of adding a duplicate.)

- [ ] **Step 2: Add the Sleep section**

Inside the Automation `<a-tab-pane>`, AFTER the Scheduled Restart `</a-form-item>` and before the pane's closing `</a-tab-pane>`, add:
```vue
            <a-divider />

            <a-form-item v-if="formData.instance.config?.sleepOnEmpty">
              <a-typography-title :level="5">{{ t("TXT_CODE_sleep_title") }}</a-typography-title>
              <a-typography-paragraph>
                <a-typography-text type="secondary">{{ t("TXT_CODE_sleep_desc") }}</a-typography-text>
              </a-typography-paragraph>

              <a-switch v-model:checked="formData.instance.config.sleepOnEmpty.enabled" class="mb-12" />
              <span class="ml-8">{{ t("TXT_CODE_sleep_enable") }}</span>

              <template v-if="formData.instance.config.sleepOnEmpty.enabled">
                <div class="mt-12">
                  <a-typography-text>{{ t("TXT_CODE_sleep_idle") }}</a-typography-text>
                  <a-input-number
                    v-model:value="formData.instance.config.sleepOnEmpty.idleTimeoutMinutes"
                    :min="1"
                    :step="1"
                    style="max-width: 160px; display: block"
                  />
                  <a-typography-text type="secondary">{{ t("TXT_CODE_sleep_idle_hint") }}</a-typography-text>
                </div>

                <div class="mt-12">
                  <a-switch
                    v-model:checked="formData.instance.config.sleepOnEmpty.wakeOnJoin"
                    :disabled="isBedrockInstance"
                    class="mr-8"
                  />
                  <span>{{ t("TXT_CODE_sleep_wake") }}</span>
                  <div>
                    <a-typography-text type="secondary">{{ t("TXT_CODE_sleep_wake_hint") }}</a-typography-text>
                  </div>
                  <a-alert
                    v-if="isBedrockInstance"
                    class="mt-8"
                    type="info"
                    show-icon
                    :message="t('TXT_CODE_sleep_wake_bedrock')"
                  />
                </div>

                <div v-if="!isBedrockInstance" class="mt-12">
                  <a-typography-text>{{ t("TXT_CODE_sleep_motd") }}</a-typography-text>
                  <a-input
                    v-model:value="formData.instance.config.sleepOnEmpty.wakeMotd"
                    style="max-width: 420px"
                    placeholder="Server is waking up... reconnect in a moment"
                  />
                  <div>
                    <a-typography-text type="secondary">{{ t("TXT_CODE_sleep_motd_hint") }}</a-typography-text>
                  </div>
                </div>
              </template>
            </a-form-item>
```
(Use `isBedrockInstance` or whatever the existing bedrock computed is named. Saves with the existing config Save flow — no save-logic change.)

- [ ] **Step 3: Type-check frontend**
```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft
npm run type-check --prefix frontend
```
Expected: no errors. (`sleepOnEmpty` is on the config type from Task 1, so bindings type-check.)

- [ ] **Step 4: Commit**
```powershell
git add frontend/src/widgets/instance/dialogs/InstanceDetail.vue
git commit -m @'
feat(#16): Sleep When Empty UI in the Automation tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 8: Build verification + push

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

Rebuild `nexcraft-web` + `nexcraft-daemon` `:test`, force-update both Test containers, then on a **Java** instance: Automation tab → enable Sleep When Empty, idle 1 min (for testing), wake-on-join on, Save. Start the server, join with 0 players → after ~1 min idle it logs "sleeping" and stops. While stopped, open the Minecraft multiplayer list with the server added → it shows the wake MOTD; the daemon logs "waking" and starts the instance; reconnect a few seconds later → join succeeds; the real server holds the port (no conflict). Join then leave → idle timer resets while you're on. Verify a **Bedrock** instance: the wake-on-join switch is disabled with the note, but enabling sleep stops an idle Bedrock server. Restart the daemon while a Java instance is asleep → the listener re-opens (wake still works). Manually start a sleeping instance from the panel → listener closes cleanly, no port conflict.

---

## Self-Review

**Spec coverage:** sleep-on-empty (Java+Bedrock) watching `currentPlayers` w/ idle timeout → Task 4 `SleepOnEmptyTask` ✓ · `mcPingOnline` guard against slow-boot false-sleep → Task 4 `if (!mcPingOnline) return` ✓ · wake-on-join Java-only TCP listener answering SLP then start → Tasks 2+3 ✓ · fake-MOTD + disconnect UX → Task 2 `buildStatusResponse`/`buildLoginDisconnect`, Task 3 connection handler ✓ · close listener the instant the server starts (port handoff) → Task 3 `instance.on("open")` + close-before-start in `triggerWake` ✓ · debounce wake → `waking` Set ✓ · bind retry on EADDRINUSE → Task 3 `server.on("error")` retry ✓ · reopen on failed start → `triggerWake` catch → `evaluate` ✓ · boot wiring + config re-apply → Task 5 ✓ · config field single-source → Task 1 ✓ · UI in Automation tab, Bedrock wake disabled w/ note → Task 7 ✓ · i18n → Task 6 ✓.

**Placeholder scan:** All code is concrete. The Task 4 Bedrock-`mcPingOnline` note is a verify-and-adapt instruction (with the fallback spelled out), not a placeholder. The Task 7 "reuse existing bedrock computed if present" names the exact alternative.

**Type consistency:** `sleepOnEmpty` shape identical across `common/global.d.ts` (Task 1), daemon default (Task 1), frontend default (Task 1), `parameters()` apply (Task 5), task reads (Task 4), service reads (Task 3), UI bindings (Task 7): `enabled`/`idleTimeoutMinutes`/`wakeOnJoin`/`wakeMotd`. Services exported as default singletons (`wakeListenerService`), imported consistently in system_instance.ts + instance.ts. SLP module exports (`writeVarInt`/`readVarInt`/`parseHandshake`/`buildStatusResponse`/`buildLoginDisconnect`) match Task 3 imports. `ILifeCycleTask` shape (`name`/`status`/`start`/`stop`) matches Task 4. ✓
