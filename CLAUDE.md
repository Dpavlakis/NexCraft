# NexCraft — project guide for Claude

**NexCraft** — a Minecraft-server control panel, built on (originally forked from) **MCSManager**.
Repo: `github.com/Dpavlakis/NexCraft` (standalone, **not** a fork anymore). Default/working branch: **`main`** (push remote alias `nexcraft`; `origin` still points at upstream `MCSManager/MCSManager` for reference).
The original MCSManager is credited (login footer + Settings → About). Keep changes Minecraft-focused.

## Monorepo layout
- `daemon/` — per-node agent. Socket RPC: `routerApp.on("ns/action", (ctx,data)=>{ protocol.response/responseError })`, registered via imports in `daemon/src/service/router.ts`. Async work in `src/service/async_task_service/`.
- `panel/` — Koa backend; proxies to daemon via `new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request("event", data)`. Routers mounted in `src/app/index.ts`. An `Error` set on `ctx.body` becomes HTTP 500.
- `frontend/` — Vue 3 + Ant Design Vue + vue-i18n + echarts. APIs via `useDefineApi<{params,data},Resp>({url,method})` (params→query, data→body; `forceRequest:true` skips the 2s cache). Cards in `config/index.ts`, routes in `config/router.ts`, default layouts in `panel/src/app/service/frontend_layout.ts`.
- `common/` — `mcsmanager-common`; **bundled from `../common/src` via a webpack alias** in daemon/panel (no tsc build of common needed). Ambient types in `common/global.d.ts`.
- `languages/*.json` — i18n; en_US.json is source of truth. Daemon uses `{{var}}`; frontend uses `{var}`.

## Build & deploy (IMPORTANT)
- **No local Node toolchain — the Docker build is the typechecker.** Make changes, commit, push to `nexcraft main`; the user pulls on Unraid and rebuilds. If a build fails, fix from the pasted error.
- **Always give the full `docker run` commands in any rebuild instructions**, and say which image changed:
  - daemon (`daemon/`, `common/`) → `nexcraft-daemon` (container `nexcraft-daemon`)
  - web (`frontend/`, `panel/`, `languages/`) → `nexcraft-web` (container `nexcraft-web`)
  - The **web build also compiles the daemon** (panel bundles daemon source), so a daemon type error breaks the web build too.
- Containers (Unraid, network `br0.2`): daemon `192.168.2.46`, web `192.168.2.47`; data under `/mnt/user/appdata/nexcraft/...`; source at `/mnt/user/appdata/mcsm-src`. Use local image tags (template GUI force-pulls). (Images/containers `nexcraft-daemon` / `nexcraft-web`, renamed from the legacy `mcsm-*:backup-test` / `mcsm-*-test`; data dir moved from `mcsm-test` to `nexcraft` on a fresh wipe.)
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Conventions / gotchas
- **Host/general process mode only — no Docker instances** (removed from the creation UI; backend left intact).
- Zip overwrite must use `node-stream-zip` (Go `file_zip` does NOT overwrite).
- Per-instance CPU/RAM = pidusage over the **process tree** (walk `/proc`), not `instance.info` (docker-only).
- Auto-Java: provision a matching JRE per pack (`{mcsm_java}` + `config.java.id`); daemon ships Java 21. Azul release dates come from the per-package detail endpoint (list endpoint omits them).
- `web.dockerfile` must install/copy daemon source + run a root `npm install` (panel imports daemon `system_file` and uses root `async-mutex`).
- vue-tsc: `a-select` v-model rejects `null` (use `undefined`); cast when feeding a widened union into a strict-typed API.
- Bundled loader logos live in `frontend/src/assets/loaders/`; brand SVGs (`curseforge.svg`, `modrinth.svg`) in `assets/`.
- Use real assets/live data, not placeholders or curated lists. Keep UI consistent (e.g. "Return" back button + power-off stop icon everywhere). Everything sans-serif.
- Status: Minecraft instances stay **Starting** until the server logs ready, then flip to **Running** (daemon `instance.ts` readiness watch). Toasts/UI key off the real RUNNING status, not the process-open event. Start needs no confirm; stop/restart/kill do.
- Instance management is full-page cards keyed by route (`/instances/<page>`): register the card in `frontend/config/index.ts`, the route in `config/router.ts`, the default page in `panel/.../frontend_layout.ts` (now **auto-merges missing default pages** into a saved layout), and a nav button in `ManagerBtns.vue`.

## Features added (this fork, beyond upstream)
- **Backups** (manual + scheduled, restore via node-stream-zip), **server icon**, **Java picker** (Adoptium/Azul → major → release, with dates) + auto-provision, **Players** (RCON), **Metrics** (process-tree CPU/RAM, zoom), **per-instance server-port auto-assign**, **client-only crash-mod stripping**.
- **Marketplace → Prism-style modpack browser** (Custom / CurseForge / Modrinth) with a custom builder (Vanilla/Paper/Purpur/Folia/Fabric/Forge/NeoForge/Quilt, real logos, live versions). Install → instance.
- **Per-instance Modpack Update card** (`ModpackUpdate.vue`, route `/instances/modpackUpdate`): reads `config.packInfo`, lists source versions, updates with auto-backup + world preservation (daemon `ModpackUpdateTask`). Admin-gated.
- **Easy MOTD editor** on Basic Settings (Java instances) → `server.properties` motd via daemon `instance/motd` (`mc_motd.ts`).
- **Autostart delay** (per-instance, `eventTask.autoStartDelay`) and **Shutdown timeout** (`config.stopTimeout`, force-kill after stop command). Player-count ping every 10s (was 60s). Deleting a running instance now force-stops then deletes.
- NexCraft branding incl. SVG favicon (`frontend/public/nexcraft_logo.svg`).

## Open / optional
- Optional: add more README/docs screenshots (Metrics, Players, Update card).

(Done since: Reset/Reinstall rework, per-instance Update card, auto-Java-on-launch, login branding, repo migration to standalone NexCraft, Plain Bedrock support, packInfo persistence fix, docs published as a VitePress GitHub Pages site at dpavlakis.github.io/NexCraft. EndStone explicitly dropped.)
