# Runtime and dependency hardening — implemented contract (audit #3)

Date: 2026-10-29. Checkout: D:/Projects/NexCraft, branch test.
Status: Code `7d66bb8b` pushed to `test`; #4 CI passed all 390 tests and build/browser/image/runtime gates. Combined #3/#4 GHCR publication requested; completion unverified. Main is unchanged.

## Runtime and dependency decisions

Shipping runtime and validation CI pin Node **24.22.2**, npm **11.19.1**. Builders and web runtime use node:24.22.2-alpine3.23@sha256:9b69af715c7f9d038150b54ccccbaeffa9064bbc93e2904c29591ca097316af1. The daemon retains Temurin Java 21 and installs the official glibc Node archive for its architecture, checking pinned SHA256 rather than copying Alpine/musl Node.

Node archive checksums: x64 48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75; arm64 eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8. Actual final-base Java/shared-library checks passed in #3 CI; arm64 execution remains unrun.

All five dependency trees use locked npm ci, with root lifecycle scripts disabled. Common installs before consumers; final images retain /opt/mcsmanager/common as the real sibling target for mcsmanager-common links, including its production dependencies. Panel builds retain required root dependencies and daemon source. Node flags precede app.js.

Compatible refreshes preserve supported owner ranges; reviewed direct majors include koa-body **8.0.1**, dockerode **5.0.1**, uuid **11.1.1**, koa-session **7.0.2**, echarts **6.1.0** and vue-i18n **11.4.16**. Frontend uses Vue **3.5.44**, Vite **7.3.7**, Vitest **4.1.12**, vue-tsc **3.3.13**, plugin-vue **6.0.10**, plugin-vue-jsx **5.1.6**, TypeScript **5.9.3** and @types/node **24.19.2**. VueUse remains **10.3.0**. The [results record](../plans/2026-10-29-runtime-dependency-hardening-results.md) lists exact installed versions by tree.

Root lock format remains version 3 and subtree locks version 2. There is no blanket audit fix, forced incompatible override or direct transitive-dependency workaround. Unused direct zrender and obsolete bundled-type duplicates were removed. Root/frontend i18next-scanner is development tooling; its reclassification does not fix deepmerge.

## Compatibility contracts and evidence

| Area | Implemented behavior and verification |
| --- | --- |
| Parser | Named koaBody exports and narrow Koa 2 request typings preserve middleware order, GET/PUT/POST/DELETE parsing, JSON/form/multipart shapes, 10 MB JSON and 100 MB daemon / 500 MB panel file limits. Real daemon upload manager/passport fixtures check bytes, cleanup and invalid-passport denial before multipart allocation. |
| Sessions | Authentication uses bounded external server-side state and documented adapter hooks on koa-session 7.0.2. Final-commit errors reach the typed bridge through autoCommit. The [auth contract](2026-10-29-authentication-hardening.md) covers revocation, staged 2FA and persistence. |
| Sockets | Three installed server trees and three client trees pass polling/WebSocket, binary/JSON acknowledgement and disconnect checks. |
| Downloads/archive/TOML | Axios redirect credential stripping and streaming, tar extract strip behavior and bytes, TOML round-trip/rejection and UUID CommonJS imports pass. |
| Dockerode | Version/info/list/inspect/progress/demux pass against loopback fake Docker transport; real-engine smoke remains unrun. |
| i18n | Actual initializer/useI18n, real catalogs, English fallback, interpolation and saved locale switching pass with supported legacy mode retained. |
| Charts | Actual Overview options pass SVG SSR/API checks, axes, zoom, resize and HTML tooltip checks. Actual compiled InstanceChart paints a canvas at desktop/mobile widths. Comprehensive chart visual equivalence is outside the recorded sample. |
| Tooling | Full frontend type-check/build passes with integrated timer/filter/module-resolution adaptations and seven explicit callback types; no test assertions or behavior were weakened. |
| Production boot | Ant Design and its root/nested icon family share one chunk; ECharts and zrender share another. This removes the reciprocal chunk imports that crashed colors.primary before Vue mounted. The maintained production smoke helper detects cold-boot errors and missing assets. |

The existing parser onError callbacks **log and continue**, yielding HTTP 200 with an absent body for malformed/oversized JSON in the isolated harness. This is the confirmed preexisting #3 baseline, **not fixed by #3**. Request rejection is implemented in **#4 reliability**, whose local verification is complete, with remote CI passed and combined publication requested in the [results](../plans/2026-10-29-reliability-hardening-results.md).

## Final audits and residual ownership

Counts below are affected package nodes, including affected owners; they are not independent advisory or exploit counts.

| Tree | Production | Full |
| --- | ---: | ---: |
| root | 0 | 1 |
| common | 0 | 0 |
| daemon | 0 | 0 |
| panel | 2 | 2 |
| frontend | 0 | 1 |

Panel's two high affected nodes, koa-session 7.0.2 and Zod 3.25.76, represent **one session-to-Zod 3 advisory chain**. Located use validates trusted startup configuration/function signatures; no attacker-controlled oversized-array schema path has been established. A compatible session upstream fix or separately reviewed replacement owns follow-up. Forcing Zod 4 breaks Zod 3 function APIs; parser-owned Zod independently resolves to 4.6.7.

Root/frontend each report the **same low development deepmerge 4.3.1 advisory** through i18next-scanner. Follow-up belongs to scanner/deepmerge upstream or a separately reviewed scanner replacement. No final critical findings are recorded; these results do not establish zero vulnerabilities, complete security or compliance.

## Final verification and release gates

Linux Node 24.22.2 with strict unhandled rejections passes **256/256** root security tests: 190 prior + 53 authentication + 13 dependency. Authentication also passed **53/53** on Windows Node 24.16.0 / session 6.2.0 and Linux / session 7.0.2. Account/iframe tests pass **26/26** on Vitest 4.1.12. Daemon/panel builds and full frontend type-check/build pass.

Compiled production cold login passes at 1440 light and 390 dark: Vue and forms mount, all 14 assets per case return HTTP 200 and there are zero page errors. Compiled Instances/account and chart-canvas checks pass. The maintained helper rejects both the preserved failing baseline and a missing-CSS negative control. A lockfile-fresh Windows development preview also passed an expanded sample without runtime/network errors.

CI includes backend discovery, UI tests, frontend type/build, scripts/frontend-production-smoke.mjs using hosted Chrome, and final-image build/runtime/common-link/HTTP/graceful-exit gates. These **Docker final-image and hosted Chrome CI gates passed** in run 40940013639; see the hosted CI outcome below. Combined #3/#4 GHCR publication is now requested; completion is unverified and main is unchanged. Broader design preview work and Modpack/Custom sections remain queued for #5.

## Reference material

- [Implementation and verification record](../plans/2026-10-29-runtime-dependency-hardening.md) and [detailed results/evidence paths](../plans/2026-10-29-runtime-dependency-hardening-results.md).
- [Node 24.22.2 checksums](https://nodejs.org/download/release/v24.22.2/SHASUMS256.txt), [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/).
- [Koa Body source](https://github.com/koajs/koa-body), [Koa Session source](https://github.com/koajs/session), [Dockerode v5](https://github.com/apocas/dockerode/releases/tag/v5.0.0).
- [Zod residual advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [deepmerge residual advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
- [ECharts v6 migration](https://echarts.apache.org/handbook/en/basics/release-note/v6-upgrade-guide/), [vue-i18n v11 migration](https://vue-i18n.intlify.dev/guide/migration/breaking11).

## Hosted CI outcome and publication status

[Successful #3 CI run 40940013639](https://github.com/Dpavlakis/NexCraft/actions/runs/40940013639) passed on Node 24.22.2: security 256/256, account/iframe 26/26, daemon/panel/frontend builds, hosted Chrome cold boot, both actual Docker image builds, runtime/npm/common links, Java/shared libraries, fresh HTTP startup and SIGTERM exit 0. Source was `673783fd`; follow-up `4fd56431` added bounded HTTP readiness retries. [Initial run 40939107627](https://github.com/Dpavlakis/NexCraft/actions/runs/40939107627) failed only because its startup probe reset roughly 0.3 seconds after launch; that initial run did not pass. These outcomes are parent-supplied evidence.

Code commit `7d66bb8b` was pushed to `test`. [#4 CI run 40942055728](https://github.com/Dpavlakis/NexCraft/actions/runs/40942055728) passed in full: **390 tests (272 backend, 26 account/iframe, 92 reliability)**, daemon/panel/frontend type-check/build, hosted Chrome, both actual Docker image builds, final runtime/common/npm/Java/shared-library checks, fresh HTTP startup and SIGTERM exit 0.

Combined #3/#4 GHCR publication was requested successfully with `gh workflow run docker.yml --ref test --repo Dpavlakis/NexCraft`: [publish run 40942868091](https://github.com/Dpavlakis/NexCraft/actions/runs/40942868091). Dispatch success does not establish build completion; completion was not watched or claimed. Main is unchanged. After the workflow turns green, update both existing Web and Daemon containers and sign in again because browser sessions are process-local. #5 waits for the user's live test; promotion to `main` requires manual acceptance. Nonblocking action-metadata annotations report Node 20 actions under forced Node 24; #27 now queues a refresh to verified action versions, with no action major bumps in this batch.

The parent will commit/push this documentation-only checkpoint after the publish run started. The publish head is code-validated `7d66bb8b`; these documentation files are not copied into the images.
