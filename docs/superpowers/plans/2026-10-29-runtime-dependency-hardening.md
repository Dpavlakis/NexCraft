# Runtime and dependency hardening — implementation and verification record (audit #3)

Date: 2026-10-29. Checkout: D:/Projects/NexCraft, branch test.
Status: source changes integrated and locally verified; Docker final-image and hosted Chrome CI gates pending the parent push.
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

## Pending gates and follow-up

- Docker final-image CI and hosted Chrome CI have not run. The parent records their results after push; local Linux/Edge checks do not establish success on those environments.
- Actual Alpine/Temurin assembly/startup, final-base Java/shared-library checks, arm64 execution and real-engine Dockerode smoke remain unrun.
- No #3 GHCR dispatch has occurred; main is unchanged.
- Production/full audits retain one high session-to-Zod 3 advisory chain (two panel nodes) and one low development deepmerge advisory duplicated in root/frontend scanners. Upstream compatible fixes or separately reviewed replacements own follow-up.
- Existing malformed/oversized JSON callbacks log and continue with HTTP 200. #3 preserves this preexisting behavior; explicit rejection handling is queued for #4 reliability.
- Broader design/UserList and Modpack/Custom work remain queued for #5.

Local verification is complete for the recorded scope; CI/container outcomes must be added after they actually pass.
