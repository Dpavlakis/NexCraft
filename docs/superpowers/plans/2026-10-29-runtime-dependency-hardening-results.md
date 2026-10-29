# Runtime and dependency hardening — final implementation results (audit #3)

Date: 2026-10-29. Checkout: D:/Projects/NexCraft, branch test.
Status: #3 source `673783fd` and readiness follow-up `4fd56431` passed hosted CI, including Chrome cold boot and both actual Docker final-image gates. No #3 GHCR dispatch has occurred; main is unchanged. The parent will publish #3 and #4 together after #4 CI passes.

## Final integrated verification

| Check | Verified result |
| --- | --- |
| Authentication compatibility | 53/53 on Windows Node 24.16.0 / koa-session 6.2.0 and Linux Node 24.22.2 / koa-session 7.0.2 |
| Combined root security | 256/256 on Linux Node 24.22.2 with strict unhandled rejections: 190 prior + 53 auth + 13 dependency |
| Account/iframe UI | 26/26 under Vitest 4.1.12 |
| Builds | Daemon/panel builds and full frontend type-check/build pass after seven explicit callback types |
| Compiled production login | 1440 light and 390 dark mount Vue/forms; all 14 assets per case HTTP 200; zero page errors |
| Compiled Instances/account/chart | Read-only authenticated sample and InstanceChart canvas pass at both widths |
| Production-helper controls | Preserved failing baseline and missing-CSS negative control are both rejected |
| Windows dev preview | Lockfile-fresh dependencies; expanded sample passes without runtime/network errors at http://localhost:4180/ |

No tests were weakened. The two review-confirmed auth issues are fixed: logout is immediate and independent of disk/User locks; ambiguous deletion quarantines authentication and authoritative missing-record reload removes the stale User. Expiry sweeps clear staged secrets. All 53 auth cases are integrated; older incomplete snapshots are superseded.

The production/full audit node counts, in root/common/daemon/panel/frontend order, are **0/0/0/2/0** and **1/0/0/2/1**. Residuals represent one high session-to-Zod 3 advisory chain and one low development deepmerge advisory duplicated across root/frontend scanner trees.
## Persistent disposable environment

- Repository: /home/dimit/nexcraft-runtime.K43JZB/repo (Ubuntu Linux filesystem).
- Node: /home/dimit/nexcraft-runtime.K43JZB/toolchain/bin/node — 24.22.2.
- npm: /home/dimit/nexcraft-runtime.K43JZB/toolchain/bin/npm — 11.19.1.
- Evidence: /home/dimit/nexcraft-runtime.K43JZB/evidence (raw audit JSON stays outside the checkout).
- Fresh production trees: /home/dimit/nexcraft-runtime.K43JZB/runtime/{common,daemon,web}.
- Isolated daemon build: /home/dimit/nexcraft-runtime.K43JZB/isolated-daemon.

The official x64 Node archive was actually downloaded and checked against pinned SHA256 48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75; its entry matched the downloaded official SHASUMS256.txt. Initial /tmp staging disappeared on WSL restart; retained evidence/tools use persistent /home/dimit storage. Windows Node remains 24.16.0; actual Windows node_modules have since been refreshed from the final locks (Vue 3.5.44, vue-i18n 11.4.16, Vite 7.3.7).

## Installed versions and scope

Batch A retained manifest ranges. npm initially selected compressing 1.10.6; its accepted lock was deliberately resolved to reviewed 1.10.5. Root lock remains version 3; four subtree locks remain version 2. No blanket audit fix, force, cross-major override, new direct transitive dependency, or VueUse major upgrade.

| Tree | Actual installed versions |
| --- | --- |
| common | socket.io 4.8.4, compressing 1.10.5, typescript 5.9.3, @types/node 24.19.2 |
| daemon | tar 7.5.22, axios 1.21.0, socket.io 4.8.4, socket.io-client 4.8.4, compressing 1.10.5, smol-toml 1.9.1, koa-body 8.0.1, dockerode 5.0.1, uuid 11.1.1, typescript 5.9.3, @types/node 24.19.2 |
| panel | axios 1.21.0, socket.io 4.8.4, socket.io-client 4.8.4, nanoid 3.3.20, koa-body 8.0.1, uuid 11.1.1, koa-session 7.0.2, typescript 5.9.3, @types/node 24.19.2 |
| frontend | axios 1.21.0, socket.io-client 4.8.4, vue 3.5.44, sanitize-html 2.18.1, fflate 0.8.3, nanoid 3.3.20, uuid 11.1.1, echarts 6.1.0, vue-i18n 11.4.16, vite 7.3.7, @vitejs/plugin-vue 6.0.10, @vitejs/plugin-vue-jsx 5.1.6, vitest 4.1.12, vue-tsc 3.3.13, typescript 5.9.3, @types/node 24.19.2, @vueuse/core 10.3.0 |

TypeScript 5.9.3 and reviewed tooling C versions are accepted after integrated compatibility adaptations proved type/build behavior. Obsolete UUID/i18n/session type packages were removed where packages supply declarations. Unused direct zrender was removed; ECharts owns its 6.1.0. i18n.ts passed actual initializer/useI18n/fallback/interpolation/saved-locale tests unchanged; legacy mode remains supported by [v11](https://vue-i18n.intlify.dev/guide/migration/breaking11).

Root/frontend i18next-scanner moved to devDependencies after script/source inspection. This narrows production classification; it does not fix deepmerge. Existing package scripts, including full backend security-test discovery, are preserved.

## Audit counts

Counts are vulnerable package nodes including affected owners, not independent exploit counts.

| Tree | Baseline production / full | Batch A production / full | Final production / full |
| --- | ---: | ---: | ---: |
| root | 3 / 4 | 1 / 2 | 0 / 1 |
| common | 9 / 9 | 0 / 0 | 0 / 0 |
| daemon | 19 / 23 | 4 / 8 | 0 / 0 |
| panel | 15 / 21 | 4 / 10 | 2 / 2 |
| frontend | 21 / 39 | 7 / 25 | 0 / 1 |

Final panel production/full retain two high affected nodes, koa-session 7.0.2 and Zod 3.25.76, representing ONE session-to-Zod 3 advisory chain. Root/frontend full each report the same low development deepmerge advisory via their scanner trees. These are node counts, not distinct advisory counts. No final critical findings are recorded; this is not a zero-vulnerability, complete-security or compliance claim.

- Session/Zod 3: trusted startup options and function signatures use Zod 3 APIs (.args/.returns). No supported patched 3.x release was verified; no attacker-controlled oversized-array schema path was established. Do not override to Zod 4. Follow-up owner: session upstream compatible fix or separately reviewed replacement. Parser Zod resolves naturally to 4.6.7.
- Scanner/deepmerge 4.3.1: unpatched low through development-only i18next-scanner. This remains build-tool exposure. Follow-up owner: scanner/deepmerge upstream or separately reviewed scanner replacement.

## Verified behavior and integrated compatibility

The 13 focused dependency tests exercise actual configured parser methods and body/file shapes, configured maxima and scaled overflow/max-file behavior; real daemon upload/passport/mission managers with byte/cleanup checks; three Socket.IO server and three client trees over polling/WebSocket with binary acknowledgement/disconnect; tar strip extraction; TOML round-trip/rejection; Axios redirect credential stripping and streaming; Dockerode version/info/list/inspect/progress/demux against loopback fake Docker; UUID CommonJS; and session cookie round-trip/tamper/expiry/logout.

Actual i18n initializer/useI18n components, real catalogs, fallback, interpolation and saved locale switching pass. Actual Overview options pass ECharts SVG SSR/API checks at desktop/mobile widths, including resize, axes, tooltip and zoom. Compiled browser canvas checks are recorded below; comprehensive visual equivalence remains outside this sample.

Koa 2 Request augmentation for body/rawBody/files, externalKey callback Koa.Context annotations, named koaBody boundaries, timer/filter typings and Vitest bundler module resolution are integrated in source. Seven explicit callback types complete the full frontend checker migration. Production session mutations use autoCommit and the outer typed error bridge; explicit Session.save calls are absent from authentication/SSO. No Koa major override or skipLibCheck relaxation was used.

AntDesignVueResolver, JSX, CSS and intentional chunk grouping remain. Bundle-size/Sass deprecation notices remain non-fatal. Vitest runs from frontend with --config src/components/__tests__/account-security.config.ts and fileParallelism:false/maxWorkers:1; installed tooling has Vite 7.3.7 without the old vite-node/tinypool graph.

Fresh npm ci --omit=dev --ignore-scripts installs pass in common/daemon/web, with both common links resolving. Production audits there are common 0, daemon 0, web 2. Built daemon/panel start from temporary data, serve HTTP, complete real daemon auth and info/overview RPC, and exit 0 on SIGTERM. Official x64 zip/PTY tools were staged in disposable runtime/lib. No real user data or Minecraft instance was used; Linux Node ldd has no missing libraries.

**Parser reliability follow-up (#4):** at the #3 baseline, onError callbacks logged and continued; malformed/oversized JSON yielded HTTP 200 with absent data in the isolated harness. #3 did not fix this defect. #4 implements rejection handling; see its [results](2026-10-29-reliability-hardening-results.md) for final verification status.

## Runtime, CI and remaining gates

Builders/web pin node:24.22.2-alpine3.23@sha256:9b69af715c7f9d038150b54ccccbaeffa9064bbc93e2904c29591ca097316af1. Daemon retains Temurin Java 21 with official glibc Node 24.22.2 and architecture-specific SHA256 verification. Locked npm ci installs disable root lifecycle scripts; common installs before consumers and remains a real runtime sibling. Node flags precede app.js.

CI supports Node 24.22.2, preserves full backend discovery and adds account/iframe tests, frontend type/build, compiled cold-login smoke, and final-image build/runtime/common-link/HTTP/graceful-exit gates. Workflow triggers cover relevant frontend/backend/dependency/Docker/helper paths. Checkout/setup action majors and publisher workflow remain unchanged.

Docker final-image CI and hosted Chrome CI passed in run 40940013639, including actual Alpine/Temurin image builds/startup and final-base Java/shared-library verification. Arm64 execution and real-engine Dockerode smoke remain unrun. No #3 GHCR dispatch has occurred; publication awaits #4 CI as recorded below.

## Resume locations

Final integrated Linux source and production output: /home/dimit/nexcraft-integrated.MQy9oG and its frontend/dist. Retained toolchain/audit/runtime evidence is listed above. The [implementation record](2026-10-29-runtime-dependency-hardening.md) contains repeat-verification commands for a prepared locked snapshot; no source patch application remains.

## Production bootstrap regression — verified 2026-10-29

The integrated source passed all 256 backend tests, 26 account/iframe tests and daemon/panel/frontend builds before production browser verification exposed this regression. The regression explains why a compiled browser gate is required in addition to tests and builds.

The unchanged Vite 7 build failed before Vue mounted: `TypeError: Cannot read properties of undefined (reading 'primary')` at `assets/ant-BN2z7AX7.js:57:1679`. The recorded source map resolves to nested `@ant-design/icons-vue/es/components/AntdIcon.js:31`, `setTwoToneColor(blue.primary)`. Splitting `ant-design-vue/es` into `ant-es` and its remaining/nested packages into `ant` produced reciprocal static chunk imports.

Only `frontend/vite.config.ts` manualChunks changed in product configuration: all `ant-design-vue/` and root/nested `@ant-design/` modules now share `ant`; ECharts and zrender share `echart`. All other intentional grouping remains. The rebuilt static import graph has no chunk cycles. The tradeoff is larger cohesive chunks: Ant Design 1,325.72 kB (385.94 kB gzip), ECharts 1,126.69 kB (378.37 kB gzip). The existing size threshold still reports these; no threshold increase, package downgrade, exception suppression or entry workaround was used.

Final source files `frontend/vite.config.ts` and `scripts/frontend-production-smoke.mjs` were copied into `/home/dimit/nexcraft-integrated.MQy9oG`; frontend full type-check/build passed using `/home/dimit/nexcraft-runtime.K43JZB/toolchain/bin/node` 24.22.2 and npm 11.19.1. No dependencies were installed or changed by this verification. Build log: `/home/dimit/nexcraft-boot-fix.Ya6geo/final-build.log`.

The maintained helper uses Node 24 built-in HTTP, WebSocket and Chrome DevTools Protocol APIs, without additional npm dependencies. It serves real dist bytes with read-only local fixtures, denies external requests, mutations, sockets and downloads, and creates separate cold browser contexts at 1440×1000 light and 390×844 dark. It checks Vue's mounted app, the visible login form, hidden loader, theme, successful assets and uncaught exceptions. Failure diagnostics are printed for CI; JSON and PNG evidence remain in its unique OS temp directory. A 50-second deadline bounds the run; cleanup closes only its own browser/server and removes only its verified temporary browser profile.

```sh
node scripts/frontend-production-smoke.mjs --dist frontend/dist --browser /path/to/google-chrome
```

The CI step follows the existing frontend production build, checks `google-chrome`/`google-chrome-stable` on PATH and runs the helper. The helper is included in workflow path triggers. No action or dependency was added. The [official hosted Ubuntu 24.04 inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md#browsers-and-drivers), image 20261026.354.1 checked on 2026-10-29, lists Google Chrome. Hosted Actions Chrome execution subsequently passed in run 40940013639. The earlier local browser validation used isolated Edge 156.0.4314.50 and Windows Node 24.16.0 reading the real Linux-built dist through the WSL share.

| Browser control | Actual result |
| --- | --- |
| Preserved unchanged baseline, both viewports | Helper exits 1; Vue/form absent, original `primary` exception in both cases. Index SHA256 matches the originally recorded failure. |
| Final compiled build, both viewports | Helper exits 0; Vue/form visible, loader hidden, expected light/dark class, 14 assets per case all HTTP 200, zero uncaught errors/failed requests/bad responses. |
| Disposable build with one CSS asset removed | Helper exits 1 for both viewports despite mounted Vue/form; asset HTTP 404 is detected. Only a hard link in the disposable copy was removed. |
| Actual compiled Instances/account UI | Read-only fake admin, node and general-process instance render; account modal opens through the real desktop/mobile user menu in both viewports. No account operation was submitted. |
| Actual compiled Overview InstanceChart | ECharts initializes and paints a canvas at both widths: 1326×250 desktop (5,499 painted pixels), 332×250 mobile (1,388). Zero uncaught errors, failed requests, non-200 responses or blocked requests throughout authenticated checks. |

All application traffic in these checks stayed at `http://localhost:4182/`; no real user data, daemon, Minecraft instance or remote application service was used. Browser profiles were removed and owned browser/server processes stopped. This isolated production check left port 4180, shared node_modules and `.nexcraft-preview-cache-preserve` untouched at the time. The later lockfile-fresh Windows development preview passed an expanded sample without runtime/network errors at http://localhost:4180/. The authenticated fixture adapter stays in task temp; the maintained CI helper deliberately covers the narrow cold-login regression. This local sample does not establish all-route/backend validation or chart visual equivalence. Separate shipping-image and hosted-Chrome CI success is recorded below.

Exact evidence:

- Original failure: `C:\Users\dimit\AppData\Local\Temp\nexcraft-prod-smoke-20261029-125908\report.json`.
- Final helper against baseline: `C:\Users\dimit\AppData\Local\Temp\nexcraft-production-smoke-J4L3iK\report.json` (both failure screenshots alongside).
- Final helper success: `C:\Users\dimit\AppData\Local\Temp\nexcraft-production-smoke-zJieCu\report.json`; screenshots `login-1440-light.png` and `login-390-dark.png` alongside.
- Missing-CSS negative control: `C:\Users\dimit\AppData\Local\Temp\nexcraft-production-smoke-CNRzSu\report.json`.
- Authenticated/chart success: `C:\Users\dimit\AppData\Local\Temp\nexcraft-production-smoke-sp5vhG\report.json`; screenshots `instances-1440-light.png`, `instances-390-dark.png`, `account-1440-light.png`, `account-390-dark.png`, `echarts-1440-light.png`, `echarts-390-dark.png` alongside. Temporary adapter: `C:\Users\dimit\AppData\Local\Temp\nexcraft-production-auth-qa-jMIuFX\qa.mjs`.
- Production output: `/home/dimit/nexcraft-integrated.MQy9oG/frontend/dist`; principal files `index.html`, `assets/index-CNTAJQft.js`, `assets/mount-D-oPE9Z_.js`, `assets/ant-CWI-SgKr.js`, `assets/echart-BhOSovaa.js`.
- Index SHA256: `0c1a0a640e7c6c313cf86b9027268b34cd4d932fffe8a044273262962c7d6fb0`. Principal-file checksums and static graph: `/home/dimit/nexcraft-boot-fix.Ya6geo/production-sha256.json` and `chunk-graph.json`. Baseline retained at `/home/dimit/nexcraft-boot-fix.Ya6geo/baseline-dist` with original index SHA256 `2ff8989326d0b93cd397f3386fcd349e952211ae0b9568cd7a58e1e04f9aa38c`.

The production-bootstrap fix consists of the chunk config, maintained helper and security-validation browser step/trigger. Overall #3 implementation and local integration are complete. Docker final-image and hosted Chrome CI gates subsequently passed in run 40940013639, as recorded below. No #3 GHCR dispatch has occurred; main is unchanged. Broader design preview work is unchanged, with Modpack/Custom sections queued for #5.

## Hosted CI outcome and publication status

[Successful #3 CI run 40940013639](https://github.com/Dpavlakis/NexCraft/actions/runs/40940013639) passed on Node 24.22.2: security 256/256, account/iframe 26/26, daemon/panel/frontend builds, hosted Chrome cold boot, both actual Docker image builds, runtime/npm/common links, Java/shared libraries, fresh HTTP startup and SIGTERM exit 0. Source was `673783fd`; follow-up `4fd56431` added bounded HTTP readiness retries. [Initial run 40939107627](https://github.com/Dpavlakis/NexCraft/actions/runs/40939107627) failed only because its startup probe reset roughly 0.3 seconds after launch; that initial run did not pass. These outcomes are parent-supplied evidence.

No #3 GHCR dispatch has occurred; main is unchanged. The parent integrates, reviews and tests, then commits/pushes `test` and dispatches GHCR after successful #4 CI so #3 and #4 publish together. Promotion to `main` requires manual acceptance. Nonblocking action-metadata annotations report Node 20 actions under forced Node 24; #27 now queues a refresh to verified action versions, with no action major bumps in this batch.
