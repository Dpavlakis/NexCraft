# Reliability hardening — implementation results and publication status (audit #4)

Date: 2026-10-29. Checkout: `D:/Projects/NexCraft`, branch `test`.
Status: implementation/review, local verification and #4 CI complete. Code `7d66bb8b` pushed to `test`; #4 CI passed all 390 tests and build/browser/image/runtime gates. Combined #3/#4 GHCR publication requested; completion unverified. Main is unchanged.
Contract: [specification](../specs/2026-10-29-reliability-hardening.md). Execution record: [plan](2026-10-29-reliability-hardening.md).

## Delivered behavior

| Area | Implemented contract and review status |
| --- | --- |
| R1 upload queue | Failed initialization removes the entry once and advances eligible work; late initialization cannot revive cancelled entries or take over a replacement queue. |
| R2 batch ownership | Selection belongs to the active node's loaded page; batch admission snapshots the daemon/UUIDs, and stale delete confirmations submit nothing. |
| R3 file navigation | Listing/navigation generations fence stale success, failure, rollback and loading continuations. The final parent-reviewed P2 correction transfers pending tab metadata only to the winning same-tab/path listing when search supersedes navigation. |
| R4 instance polling | Disposal wins over the awaited initial fetch and prevents post-unmount interval allocation. |
| R5 terminal setup | Setup/socket ownership prevents late allocation after disposal and rejects obsolete overlapping callbacks. TerminalCore also guards awaited setup and disposes its xterm/resources at teardown. |
| R6 scheduled restart | Cancellation/reapply invalidates active countdowns and saved callbacks; sequence-owned overlap cleanup cannot unlock a replacement run. |
| R7 parser rejection | Malformed/oversized JSON is rejected at production parser boundaries with 400/413 before downstream handlers; valid requests and ordinary application errors retain their behavior. |

Focused regressions use actual source with controlled asynchronous boundaries. Independent reviews and the final parent review are complete for the R3 correction. The author reproduced 8 failures before the fix, then passed the focused regressions including stale failures, switchback, Windows paths and default tabs. This documentation sidecar does not edit source.

## Final local verification

These results are supplied by the parent; this sidecar ran no suites or builds.

| Check | Actual checkpoint |
| --- | --- |
| Backend security, strict Linux Node 24.22.2 | 272/272 passed, zero skips |
| Daemon and panel builds | Passed |
| Final R3/file-manager + upload focused checks | 51/51 passed: 39 file-manager + 12 upload; 8 pre-fix failures reproduced |
| R2/R4/R5 focused checks | Other 41 tests remain passing |
| Full frontend reliability | Final Linux run after R3 correction: 92/92 passed |
| Windows frontend type-check | Passed after reviewer fixed a test-fixture type failure; no cast or compiler changes |
| Final Linux frontend type-check and production build | `npm run build --prefix frontend` passed: type-check plus Vite production build, built in 16.11 seconds |
| Final production browser check | PASS with isolated Edge against actual final dist: 1440 light and 390 dark, Vue/login true, zero page errors, all 14 assets HTTP 200 per case |
| Final review of R3 correction | Complete and parent-reviewed; focused post-fix checks pass |
| #4 hosted CI, including actual image/runtime/browser gates | FULL SUCCESS, run 40942055728: 390 tests (272 backend + 26 account/iframe + 92 reliability), builds, hosted Chrome, both actual Docker images, runtime/common/npm/Java/shared libraries, fresh HTTP startup and SIGTERM exit 0 |

Do not substitute #3's successful run for #4 validation. The historical 79/79 count predates the correction; do not label it as the final full-suite result. The final post-fix Linux suite and production build results above are parent-supplied. No further application changes are planned; compiled browser verification also passes. Local verification and #4 CI are complete. Code `7d66bb8b` is pushed; combined #3/#4 GHCR publication is requested, with completion unverified. Main is unchanged.

## Compiled browser evidence

Parent-reported helper outcome: PASS against the actual final compiled dist, using isolated Edge at 1440 light and 390 dark. Vue and login are true, page errors are zero, and all 14 assets return HTTP 200 in each case.

- Report: `C:\Users\dimit\AppData\Local\Temp\nexcraft-production-smoke-VoRB1I\report.json`.
- Actual final dist: `D:\Projects\NexCraft\frontend\node_modules\.cache\nexcraft-preview\reliability-production-1793302676896`.

This completes #4 local verification. Separate #4 CI run 40942055728 also passed actual shipping-image and hosted-Chrome checks; these outcomes are established by #4 evidence.

## Publication and follow-up

Code commit `7d66bb8b` was pushed to `test`. [#4 CI run 40942055728](https://github.com/Dpavlakis/NexCraft/actions/runs/40942055728) passed in full: **390 tests (272 backend, 26 account/iframe, 92 reliability)**, daemon/panel/frontend type-check/build, hosted Chrome, both actual Docker image builds, final runtime/common/npm/Java/shared-library checks, fresh HTTP startup and SIGTERM exit 0.

Combined #3/#4 GHCR publication was requested successfully with `gh workflow run docker.yml --ref test --repo Dpavlakis/NexCraft`: [publish run 40942868091](https://github.com/Dpavlakis/NexCraft/actions/runs/40942868091). Dispatch success does not establish build completion; completion was not watched or claimed. Main is unchanged. After the workflow turns green, update both existing Web and Daemon containers and sign in again because browser sessions are process-local. #5 waits for the user's live test; promotion to `main` requires manual acceptance.

#3 source `673783fd` plus bounded-readiness follow-up `4fd56431` passed [run 40940013639](https://github.com/Dpavlakis/NexCraft/actions/runs/40940013639): security 256/256, account/iframe 26/26, backend/frontend builds, hosted Chrome cold boot, both actual Docker image builds, runtime/npm/common links, Java/shared libraries, fresh HTTP startup and SIGTERM exit 0. [Initial run 40939107627](https://github.com/Dpavlakis/NexCraft/actions/runs/40939107627) failed its startup probe roughly 0.3 seconds after launch; it did not pass. See the [#3 results](2026-10-29-runtime-dependency-hardening-results.md) for historical audit counts, upstream residual families and arm64 not run.

Action-metadata Node 20 annotations under forced Node 24 are nonblocking. #27 queues a verified action refresh; no action major bumps are part of this batch.

The parent will commit/push this documentation-only checkpoint after the publish run started. The publish head is code-validated `7d66bb8b`; these documentation files are not copied into the images.
