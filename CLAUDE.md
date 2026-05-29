# NexCraft — project guide for Claude

Personal fork of **MCSManager**, rebranded **NexCraft** — a Minecraft-server control panel.
Repo: `github.com/Dpavlakis/MCSManager`. Working branch: **`feat/instance-backups`** (push remote alias `fork`).
The original MCSManager is credited (login footer). Keep changes Minecraft-focused.

## Monorepo layout
- `daemon/` — per-node agent. Socket RPC: `routerApp.on("ns/action", (ctx,data)=>{ protocol.response/responseError })`, registered via imports in `daemon/src/service/router.ts`. Async work in `src/service/async_task_service/`.
- `panel/` — Koa backend; proxies to daemon via `new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request("event", data)`. Routers mounted in `src/app/index.ts`. An `Error` set on `ctx.body` becomes HTTP 500.
- `frontend/` — Vue 3 + Ant Design Vue + vue-i18n + echarts. APIs via `useDefineApi<{params,data},Resp>({url,method})` (params→query, data→body; `forceRequest:true` skips the 2s cache). Cards in `config/index.ts`, routes in `config/router.ts`, default layouts in `panel/src/app/service/frontend_layout.ts`.
- `common/` — `mcsmanager-common`; **bundled from `../common/src` via a webpack alias** in daemon/panel (no tsc build of common needed). Ambient types in `common/global.d.ts`.
- `languages/*.json` — i18n; en_US.json is source of truth. Daemon uses `{{var}}`; frontend uses `{var}`.

## Build & deploy (IMPORTANT)
- **No local Node toolchain — the Docker build is the typechecker.** Make changes, commit, push to `fork feat/instance-backups`; the user pulls on Unraid and rebuilds. If a build fails, fix from the pasted error.
- **Always give the full `docker run` commands in any rebuild instructions**, and say which image changed:
  - daemon (`daemon/`, `common/`) → `mcsm-daemon:backup-test`
  - web (`frontend/`, `panel/`, `languages/`) → `mcsm-web:backup-test`
  - The **web build also compiles the daemon** (panel bundles daemon source), so a daemon type error breaks the web build too.
- Containers (Unraid, network `br0.2`): daemon `192.168.2.46`, web `192.168.2.47`; data under `/mnt/user/appdata/mcsm-test/...`; source at `/mnt/user/appdata/mcsm-src`. Use local image tags (template GUI force-pulls).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Conventions / gotchas
- **Host/general process mode only — no Docker instances** (removed from the creation UI; backend left intact).
- Zip overwrite must use `node-stream-zip` (Go `file_zip` does NOT overwrite).
- Per-instance CPU/RAM = pidusage over the **process tree** (walk `/proc`), not `instance.info` (docker-only).
- Auto-Java: provision a matching JRE per pack (`{mcsm_java}` + `config.java.id`); daemon ships Java 21.
- `web.dockerfile` must install/copy daemon source + run a root `npm install` (panel imports daemon `system_file` and uses root `async-mutex`).
- vue-tsc: `a-select` v-model rejects `null` (use `undefined`); cast when feeding a widened union into a strict-typed API.
- Bundled loader logos live in `frontend/src/assets/loaders/`; brand SVGs (`curseforge.svg`, `modrinth.svg`) in `assets/`.
- Use real assets/live data, not placeholders or curated lists. Keep UI consistent (e.g. "Return" back button + power-off stop icon everywhere). Everything sans-serif.

## Open / optional
- Per-instance modpack **Update card** UI (backend exists).
- Rework **Reset/Reinstall** to use the new builder (data-touching — get explicit OK first).
- **EndStone** (Bedrock/Python) — would need Python added to the daemon image.
