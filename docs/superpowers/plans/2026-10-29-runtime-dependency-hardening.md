# Runtime and dependency hardening — implementation and verification record (audit #3)

Date: 2026-10-29. Checkout: D:/Projects/NexCraft, branch test.
Status: Code `7d66bb8b` pushed to `test`; #4 CI passed all 390 tests and build/browser/image/runtime gates. Combined #3/#4 GHCR publication requested; completion unverified. Main is unchanged.
Contract: [runtime specification](../specs/2026-10-29-runtime-dependency-hardening.md).
Evidence: [final results](2026-10-29-runtime-dependency-hardening-results.md).

## Completed implementation

1. Refreshed supported direct/transitive dependencies with reviewed owner ranges, preserving root/subtree lock formats. Exact installed versions and production/full audit counts are in the results record.
2. Migrated koa-body 8.0.1, Dockerode 5.0.1, UUID 11.1.1 and koa-session 7.0.2 with production API fixtures. Integrated Koa 2 request/export/callback typings; session autoCommit errors reach the outer typed bridge. All authentication changes are integrated.
3. Migrated ECharts 6.1.0 and vue-i18n 11.4.16, removed unused direct zrender and obsolete type duplicates, and validated actual initializer/chart options.
4. Migrated Vite 7.3.7, Vitest 4.1.12, vue-tsc 3.3.13 and TypeScript 5.9.3. Timer/filter/bundler-resolution compatibility and seven explicit callback types are integrated. Tests retain their assertions and behavior.
5. Pinned Node 24.22.2 / npm 11.19.1 in runtime/CI. Docker builders/web use the pinned Alpine image; daemon retains Java 21 with a checksum-verified glibc Node archive. Locked installs preserve the production common sibling and required build dependencies.
6. Corrected the production Ant manual-chunk cycle by coalescing the Ant family and grouping ECharts with its renderer. Added scripts/frontend-production-smoke.mjs and a post-build hosted Chrome CI gate.
7. Refreshed actual Windows node_modules from locks and verified an expanded development-preview sample. The broader design preview is unchanged; Modpack/Custom sections remain queued for #5.

## Completed verification

| Gate | Recorded final result |
| --- | --- |
| Root security, Linux Node 24.22.2, strict unhandled rejections | 256/256: prior 190 + auth 53 + dependency 13 |
| Authentication compatibility | 53/53 on Windows Node 24.16.0 / session 6.2.0 and Linux Node 24.22.2 / session 7.0.2 |
| UI account/iframe, Vitest 4.1.12 | 26/26 |
| Builds | Daemon/panel and full frontend type-check/build pass |
| Fresh production installs | common/daemon/web ci --omit=dev installs and common links pass |
| Linux disposable app runtime | HTTP, real daemon auth/info/overview RPC, graceful SIGTERM and no missing Node libraries pass |
| Actual compiled cold login | 1440 light and 390 dark mount Vue/forms; 14 assets per case HTTP 200; zero page errors |
| Actual compiled authenticated sample | Instances, account modal and InstanceChart canvas pass at both widths |
| Helper controls | Preserved failing baseline and missing-CSS build both correctly fail |
| Updated Windows dev preview | Expanded sample passes without runtime/network errors at http://localhost:4180/ |

The production boot failure occurred despite passing tests/builds. It is retained as the reason for the browser gate: build success alone did not detect a colors.primary exception before Vue mounted. No tests were weakened.

## Resume and repeat verification

Retained Linux Node/npm are under /home/dimit/nexcraft-runtime.K43JZB/toolchain/bin; final integrated source is /home/dimit/nexcraft-integrated.MQy9oG. Detailed reports, checksums, build logs and browser artifact paths remain in the results record. Use a fresh source snapshot and locked installs for future source changes; do not copy Windows node_modules into Linux.

These are repeat-verification commands for a prepared Linux snapshot with locked dependencies, rather than outstanding source-integration steps:

```sh
node --version # v24.22.2
npm --version  # 11.19.1
NODE_OPTIONS=--unhandled-rejections=strict npm run test:security
npm run build --prefix daemon
npm run build --prefix panel
npm run type-check --prefix frontend
npm run build --prefix frontend
(cd frontend && node node_modules/vitest/vitest.mjs run --config src/components/__tests__/account-security.config.ts)
node scripts/frontend-production-smoke.mjs --dist frontend/dist --browser /path/to/google-chrome
```

The maintained helper checks cold login against real dist bytes in isolated contexts. Authenticated read-only fixture checks are additional local evidence; the helper does not claim all-route/backend or chart visual-equivalence coverage.

## CI outcome, remaining gates and follow-up

- Docker final-image CI and hosted Chrome CI passed in run 40940013639; see the exact source/follow-up and initial failure below.
- Actual Alpine/Temurin assembly/startup and final-base Java/shared-library checks passed in #3 CI. Arm64 execution and real-engine Dockerode smoke remain unrun.
- Combined #3/#4 GHCR publication is now requested; completion is unverified and main is unchanged.
- Production/full audits retain one high session-to-Zod 3 advisory chain (two panel nodes) and one low development deepmerge advisory duplicated in root/frontend scanners. Upstream compatible fixes or separately reviewed replacements own follow-up.
- At the #3 baseline, malformed/oversized JSON callbacks logged and continued with HTTP 200. #4 implements rejection handling; its [results](2026-10-29-reliability-hardening-results.md) retain the remaining verification gates.
- Broader design/UserList and Modpack/Custom work remain queued for #5.

Local verification and the recorded #3 CI/container gates passed; publication completion and the explicitly unrun checks above remain separate gates.

## Hosted CI outcome and publication status

[Successful #3 CI run 40940013639](https://github.com/Dpavlakis/NexCraft/actions/runs/40940013639) passed on Node 24.22.2: security 256/256, account/iframe 26/26, daemon/panel/frontend builds, hosted Chrome cold boot, both actual Docker image builds, runtime/npm/common links, Java/shared libraries, fresh HTTP startup and SIGTERM exit 0. Source was `673783fd`; follow-up `4fd56431` added bounded HTTP readiness retries. [Initial run 40939107627](https://github.com/Dpavlakis/NexCraft/actions/runs/40939107627) failed only because its startup probe reset roughly 0.3 seconds after launch; that initial run did not pass. These outcomes are parent-supplied evidence.

Code commit `7d66bb8b` was pushed to `test`. [#4 CI run 40942055728](https://github.com/Dpavlakis/NexCraft/actions/runs/40942055728) passed in full: **390 tests (272 backend, 26 account/iframe, 92 reliability)**, daemon/panel/frontend type-check/build, hosted Chrome, both actual Docker image builds, final runtime/common/npm/Java/shared-library checks, fresh HTTP startup and SIGTERM exit 0.

Combined #3/#4 GHCR publication was requested successfully with `gh workflow run docker.yml --ref test --repo Dpavlakis/NexCraft`: [publish run 40942868091](https://github.com/Dpavlakis/NexCraft/actions/runs/40942868091). Dispatch success does not establish build completion; completion was not watched or claimed. Main is unchanged. After the workflow turns green, update both existing Web and Daemon containers and sign in again because browser sessions are process-local. #5 waits for the user's live test; promotion to `main` requires manual acceptance. Nonblocking action-metadata annotations report Node 20 actions under forced Node 24; #27 now queues a refresh to verified action versions, with no action major bumps in this batch.

The parent will commit/push this documentation-only checkpoint after the publish run started. The publish head is code-validated `7d66bb8b`; these documentation files are not copied into the images.
