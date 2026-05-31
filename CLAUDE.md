# NexCraft — project guide for Claude

**NexCraft** — a Minecraft-server control panel, built on (originally forked from) **MCSManager**.
Repo: `github.com/Dpavlakis/NexCraft` (standalone, **not** a fork anymore). Remotes (renamed 2026-05-31): **`origin` = `Dpavlakis/NexCraft`** (push here), **`upstream` = `MCSManager/MCSManager`** (reference only).
The original MCSManager is credited (login footer + Settings → About). Keep changes Minecraft-focused.

**Branch model (simplified 2026-05-31 — only two long-lived branches, NO `feat/*` branches):**
- **`main`** — stable / production (Unraid prod stack builds `:latest` from here).
- **`test`** — integration + testing. **All new work lands on `test`** (commit straight to it; subagent-driven execution still applies). The user dispatches the Publish Docker workflow on `test` → it tags `:test` (any non-`main` branch via `workflow_dispatch`) → the Unraid **Test** stack force-pulls `:test`. Test templates (`unraid/nexcraft-{web,daemon}-test.xml`) `<Icon>`/`<TemplateURL>` point at the `test` branch.
- **Promotion:** once work on `test` passes the manual Test-stack check, merge `test` → `main` (then prod publishes `:latest`). Don't create per-feature branches.

## Workflow (standing preferences)
- Features go **brainstorm → spec (`docs/superpowers/specs/`) → plan (`docs/superpowers/plans/`) → execution**.
- **Execution is ALWAYS subagent-driven** (superpowers:subagent-driven-development): one fresh subagent per task, with spec-compliance + code-quality review between tasks. Never inline-execute a plan unless the user explicitly overrides. (User's standing instruction — "always subagent.")

## Monorepo layout
- `daemon/` — per-node agent. Socket RPC: `routerApp.on("ns/action", (ctx,data)=>{ protocol.response/responseError })`, registered via imports in `daemon/src/service/router.ts`. Async work in `src/service/async_task_service/`.
- `panel/` — Koa backend; proxies to daemon via `new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request("event", data)`. Routers mounted in `src/app/index.ts`. An `Error` set on `ctx.body` becomes HTTP 500.
- `frontend/` — Vue 3 + Ant Design Vue + vue-i18n + echarts. APIs via `useDefineApi<{params,data},Resp>({url,method})` (params→query, data→body; `forceRequest:true` skips the 2s cache). Cards in `config/index.ts`, routes in `config/router.ts`, default layouts in `panel/src/app/service/frontend_layout.ts`.
- `common/` — `mcsmanager-common`; **bundled from `../common/src` via a webpack alias** in daemon/panel (no tsc build of common needed). Ambient types in `common/global.d.ts`.
- `languages/*.json` — i18n; en_US.json is source of truth. Daemon uses `{{var}}`; frontend uses `{var}`.

## Build & deploy (IMPORTANT)
- **Local dev repo: `D:\NexCraft`** (moved off OneDrive). Node 24 LTS + npm installed; deps installed in all workspaces. **Type-check locally before every push** (catches errors without a slow Docker round-trip):
  - daemon: `npm run build --prefix daemon` · panel: `npm run build --prefix panel` · frontend: `npm run type-check --prefix frontend` (full: `npm run build --prefix frontend`).
  - PowerShell gotcha: each shell starts with a **stale PATH** and cwd resets — prefix commands with `$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")` then `Set-Location D:\NexCraft`.
  - The OneDrive copy at `C:\Users\dimit\OneDrive\Documents\MCS` is the old location — work in `D:\NexCraft`.
- After local checks pass, commit + push to `origin main`; the user pulls on Unraid (`/mnt/user/appdata/nexcraft-src`) and rebuilds the Docker image(s). The Docker build remains the final gate.
- **Always paste the FULL copy-paste rebuild block EVERY time a rebuild is suggested** — `cd` + `git pull` + both `docker build` + `docker rm -f` + BOTH `docker run` commands (daemon incl. the `/mnt/user/Backup/Minecraft` backup mount) + `docker ps | grep nexcraft`. NEVER abbreviate with "use the block from before" or omit the run commands. Say which image(s) changed:
  - daemon (`daemon/`, `common/`) → `nexcraft-daemon` (container `nexcraft-daemon`)
  - web (`frontend/`, `panel/`, `languages/`) → `nexcraft-web` (container `nexcraft-web`)
  - The **web build also compiles the daemon** (panel bundles daemon source), so a daemon type error breaks the web build too.
- Containers (Unraid, network `br0.2`): daemon `192.168.2.46`, web `192.168.2.47`; data under `/mnt/user/appdata/nexcraft/...`; source checkout at `/mnt/user/appdata/nexcraft-src` (re-clone of `Dpavlakis/NexCraft`). Use local image tags (template GUI force-pulls). (Images/containers `nexcraft-daemon` / `nexcraft-web`, renamed from the legacy `mcsm-*:backup-test` / `mcsm-*-test`; data dir moved from `mcsm-test` to `nexcraft` on a fresh wipe.)
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
- **Import an existing server** (on the `test` branch, DONE — pending Test-stack verification, then promote `test`→`main`): zip upload → auto-detect (`server_detect.ts`), admin-only. **Java = "Import as-is" only** (run the uploaded server with its world/mods; the pack-reinstall/find-my-modpack modes were removed). **Bedrock = "Install latest BDS + keep world"** (version-lock) with an import-as-is opt-out + forced start cmd + chmod. Entry is an **"Import / Existing" source tab** in the modpack browser (the top Create-Instance cards were removed). Wizard: `frontend/src/widgets/setupApp/ImportServerReview.vue`; daemon `import_router.ts`; panel `import_router.ts` (`/protected_import`).

## In-flight / next session (checkpoint 2026-05-31)
**Branches simplified to `main` + `test`** (see Branch model up top). All in-flight work (import + World Management) is on **`test`**; `main` is untouched stable prod. The old `feat/import-existing-server` and `feat/world-management` branches were deleted (their content is all in `test`).

1. **World Management (#15) — IMPLEMENTED on `test`**, awaiting Test-stack verification. Plan: `docs/superpowers/plans/2026-05-31-world-management.md`; spec: `docs/superpowers/specs/2026-05-31-world-management-design.md`. New per-instance card `World.vue` (`/instances/world`, admin-gated): info / download (Java `<level>.zip` of world+_nether+_the_end; Bedrock `.mcworld` of `worlds/<name>` contents) / replace (upload → auto world-backup → wipe → unzip w/ `findWorldRoot`) / reset (auto-backup → remove → regen). World-only restore-compatible backup into Backups on **replace & reset only**. Daemon: `world_service.ts`, `world_replace_task.ts`, `world_reset_task.ts`, `world_router.ts`. Panel: `world_router.ts` (`/protected_world`) + op-log. Frontend: `apis/world.ts`, `World.vue`, 4 registrations + `GlobalOutlined` nav btn. **Next: run the manual checklist on the Test stack (see plan Task 9); fix on `test` if needed.**
2. **Modpack-browser UI polish** (queued, do on `test`): (a) **#28** rename the builder **"Custom" tab → "Vanilla"** + add a **clean (non-trademark) grass-block SVG** to `frontend/src/assets/` as its tab icon; (b) **#29** **Import tab/panel icon → Material "File Upload"** glyph (bundle SVG in assets/); (c) **#30** **enrich the non-modpack install-detail dialog** (Vanilla/Paper/Purpur/Folia/Fabric/Forge/NeoForge/Quilt/Bedrock) — add software blurb, logo, key features, Java-version req, links, release date/tags. *(#30 is a small feature → brainstorm/spec first.)*
3. **Roadmap remaining:** #14 Scheduled restarts w/ in-game warning · #16 Sleep-on-empty / wake-on-join · #18 trim legacy Instance Type list (non-import create path) · #27 bump `docker.yml` action pins when node24-native versions ship.
4. **Test deployment stack:** `:test` image tag (built by dispatching the Publish Docker workflow on `test`), Test Unraid templates (`unraid/nexcraft-{web,daemon}-test.xml`, Icon/TemplateURL now point at the `test` branch), isolated data `/mnt/user/appdata/nexcraft-test`, TEST-badged logo. Prod on .41/.42, **Test on .46/.47**. The user triggers the publish workflow (don't extract the GitHub token — safety-blocked). **On `test`→`main` promotion:** drop the temporary hidden-cards patch — `main`'s `frontend/src/widgets/market/index.vue` hides the Create-Instance section (commit `eac13a73`), but `test`'s version replaces those cards with the Import/Existing source tab, so take `test`'s file; main's duplicate Node24 CI commit (`bc832848`) is already semantically present on `test`.

## Open / optional
- Optional: add more README/docs screenshots (Metrics, Players, Update card).

(Done since: Reset/Reinstall rework, per-instance Update card, auto-Java-on-launch, login branding, repo migration to standalone NexCraft, Plain Bedrock support, packInfo persistence fix, docs published as a VitePress GitHub Pages site at dpavlakis.github.io/NexCraft. EndStone explicitly dropped.)
