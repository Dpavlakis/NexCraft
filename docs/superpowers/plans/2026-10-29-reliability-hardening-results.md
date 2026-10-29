# Reliability hardening — implementation results and pending gates (audit #4)

Date: 2026-10-29. Checkout: `D:/Projects/NexCraft`, branch `test`.
Status: implementation and final R3 correction delivered and independently reviewed; **local verification complete**; #4 commit/push, remote CI and GHCR pending. Main is unchanged.
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
| #4 hosted CI, including applicable image/runtime/browser gates | Pending |

Do not substitute #3's successful run for #4 validation. The historical 79/79 count predates the correction; do not label it as the final full-suite result. The final post-fix Linux suite and production build results above are parent-supplied. No further application changes are planned; compiled browser verification also passes. Local verification is complete; #4 commit/push, remote CI and GHCR have not occurred. Main is unchanged.

## Compiled browser evidence

Parent-reported helper outcome: PASS against the actual final compiled dist, using isolated Edge at 1440 light and 390 dark. Vue and login are true, page errors are zero, and all 14 assets return HTTP 200 in each case.

- Report: `C:\Users\dimit\AppData\Local\Temp\nexcraft-production-smoke-VoRB1I\report.json`.
- Actual final dist: `D:\Projects\NexCraft\frontend\node_modules\.cache\nexcraft-preview\reliability-production-1793302676896`.

This completes #4 local verification. #4 actual shipping-image and hosted-Chrome checks await remote CI; the successful #3 CI run does not establish those #4 outcomes.

## Publication and follow-up

#4 commit, push, remote CI and GHCR have not yet occurred. Main is unchanged.

Standing user authorization is Sol6.1 subagent execution. Worker no-recursion/no-commit boundaries are not human restrictions on the parent. The parent integrates/reviews/tests and commits/pushes `test`, then dispatches GHCR after #4 CI passes. #3 and #4 publish together; no #3 GHCR dispatch has occurred and `main` is unchanged. Promotion to `main` requires manual acceptance. Finish fixes and tests before further #5 design.

#3 source `673783fd` plus bounded-readiness follow-up `4fd56431` passed [run 40940013639](https://github.com/Dpavlakis/NexCraft/actions/runs/40940013639): security 256/256, account/iframe 26/26, backend/frontend builds, hosted Chrome cold boot, both actual Docker image builds, runtime/npm/common links, Java/shared libraries, fresh HTTP startup and SIGTERM exit 0. [Initial run 40939107627](https://github.com/Dpavlakis/NexCraft/actions/runs/40939107627) failed its startup probe roughly 0.3 seconds after launch; it did not pass. See the [#3 results](2026-10-29-runtime-dependency-hardening-results.md) for historical audit counts, upstream residual families and arm64 not run.

Action-metadata Node 20 annotations under forced Node 24 are nonblocking. #27 queues a verified action refresh; no action major bumps are part of this batch.
