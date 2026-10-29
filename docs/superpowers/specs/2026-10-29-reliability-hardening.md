# Reliability hardening — implemented contracts and verification status (audit #4)

Date: 2026-10-29. Status: source and final R3 correction implemented and independently reviewed; local verification complete; #4 commit/push, remote CI and GHCR pending. Main is unchanged.
Checkout: `D:/Projects/NexCraft`, branch `test`, baseline HEAD `673783fd23aed0bd42dc0214e98b999a70472049`.
Source: local audit reference `audit-reports/2026-10-29-code-validation.md` (untracked; not a published documentation link).
Execution: [reliability plan](../plans/2026-10-29-reliability-hardening.md).

## Scope and sequencing

Finish the agreed reliability fixes and their regression checks before #5 design work. Preserve working public APIs, request formats, confirmations, pagination, upload options and timing. Use small changes at existing ownership boundaries; no broad composable, scheduler, authentication or UI rewrite.

Standing user authorization is Sol6.1 subagent execution. No-recursion/no-commit limits are worker assignment boundaries, not human restrictions on the parent. The parent integrates, reviews and tests, commits/pushes `test`, and dispatches GHCR after #4 CI passes, publishing #3 and #4 together. Promotion to `main` requires manual acceptance. Finish fixes/tests before further design. The relocated shared checkout is authoritative; do not create a replacement checkout.

## Baseline findings and delivered contracts

The following seven rows preserve the inspected pre-fix evidence. R1–R7 source changes and regressions are implemented; this table is not a claim that these defects remain unchanged. The reviewed R3 P2 correction transfers pending navigation metadata only to the winning listing for the same tab/path when search supersedes navigation. The [results record](../plans/2026-10-29-reliability-hardening-results.md) distinguishes verified checks from pending acceptance.

| ID | Pre-fix source evidence | Implemented contract |
| --- | --- | --- |
| R1 | `frontend/src/services/uploadService.ts`: `UploadFiles.init` catches errors by setting `removing` and reporting, without queue advancement; `UploadService.update` cannot finish an unprepared current entry. | Initialization failure removes that entry and advances eligible queued work without suspension or a false success. |
| R2 | `frontend/src/widgets/InstanceList.vue`: `selectAllInstances` walks both card data and cached global-tree children; batch requests substitute `currentRemoteNode.uuid`. Batch controls are rendered only in single-node mode. | Select only the active node's displayed page and bind every operation to the node that owned that selection. |
| R3 | `frontend/src/hooks/useFileManager.ts`: `getFileList` commits after an unguarded await; `handleChangeDir` updates whichever tab is active afterward and restores old breadcrumbs on failure. | Only the latest live listing/navigation context can update listing, totals, tab metadata, breadcrumbs or loading state. |
| R4 | `frontend/src/hooks/useInstance.ts`: `useInstanceInfo` installs its 3-second interval after awaiting the first fetch; unmount only clears an existing handle. | A fetch settling after unmount cannot start polling. |
| R5 | `frontend/src/hooks/useTerminal.ts`: `execute` awaits channel setup before `makeSocketIo`; unmount disconnects only a socket already created. | Pending setup cannot create, connect or revive a socket after teardown; overlapping setup cannot leak another socket. |
| R6 | `daemon/src/service/scheduled_restart_service.ts`: cancellation removes the scheduled job, while an active sequence continues through `sleep`; only RUNNING status is checked. | Disabling, cancelling or replacing a schedule invalidates its countdown and queued callbacks before further commands/restart. |
| R7 | `daemon/src/service/http.ts` and `panel/src/app/service/authentication.ts`: production `koaBody.onError` only logs. Installed koa-body proceeds to `next()` when this callback returns. | Malformed JSON returns 400, oversized JSON returns 413, and neither reaches downstream handlers. |

At the baseline, `scripts/security-tests/dependency-parser.test.cjs` explicitly expected HTTP 200 with absent parsed data for malformed/oversized JSON. This recorded the old defect. R7 now expects rejection and retains valid-request coverage.

## Behavioral contracts

### R1 — upload queue progress

Use one idempotent failure/removal transition for failed initialization and queue advancement. Remove the entry using its actual registration identity, including temporary/server-ID transitions. Notify existing end observers once, report failure once, and never increment successful-upload totals or show a success toast for failure. A failed non-current entry must not disturb current chunks.

Preserve five chunk workers, 2 MiB chunks, resume offsets, retry/suspend behavior, overwrite/unzip options and ordinary cancellation. Cancellation/stop while initialization is pending must not let a late result recreate a removed map entry, steal a new queue's current pointer or upload data.

### R2 — visible selection and daemon ownership

Keep batch operations restricted to the existing single-node UI. Select All means selectable cards on the currently loaded, filtered page; exclude inactive tree data, unloaded pages and load-more markers. Clear/invalidate selection when the owning node or query/page changes. While fresh data for a new owner is pending, cached cards from another owner cannot become an actionable selection.

Capture the owning daemon and selected UUIDs at action admission. Use that snapshot for start/stop/restart/kill and both delete modes, including the later confirmation callback. A context change before confirmation invalidates the pending action; submit no request for a stale selection. Deduplicate within the owning daemon; never infer ownership from the node selected at submission time. No cross-node batch feature or backend payload redesign.

### R3 — latest listing/navigation owns mutations

Track a generation and immutable request context: daemon, instance, tab identity, path, page, page size and search. Accept a result only while its generation is current, the hook is live and its context still matches. A generation is necessary even for A → B → A navigation or repeated identical requests.

Apply the same ownership check to success, failure rollback, default-tab initialization, tab path/name commits and listing-related loading completion in callers. A stale failure must not restore old breadcrumbs, start a rollback fetch, report a misleading active-view error or hide a newer loading indicator. Keep current-request errors and `throwErr` behavior; callers must recognize obsolete operations before applying their error handling. Preserve tab persistence, Windows drive paths, pagination and explicit refresh behavior. Abort support is optional; ignoring obsolete results remains mandatory.

### R4/R5 — disposal wins over awaited setup

Set disposal/invalidation state synchronously during unmount and check it after each relevant await, before allocating polling/socket resources. Keep live polling intervals and terminal authentication/events/reconnect behavior intact. Existing cleanup remains effective and repeatable; do not replace the timers merely to change their TypeScript types.

For terminal setup, share an in-flight request for the same target or fence superseded attempts so at most one valid socket survives. Never reuse a pending setup for a different daemon/instance. Bind handlers to their owning socket/generation; callbacks from obsolete sockets cannot authenticate or update a newer connection. Late setup failures must not revive resources or emit errors for a disposed view. Preserve callers' successful `execute` behavior.

### R6 — countdown cancellation

Assign an identity/generation to every armed schedule and active sequence. Invalidate it on every cancel/reapply, even with no job-map entry. Capture it in scheduled callbacks, reject obsolete callbacks at entry, and check validity after command/sleep awaits and immediately before each new warning/restart. Recheck enabled state and RUNNING status.

Own the overlap marker by sequence identity: an old sequence's `finally` cannot clear a newer sequence's marker, and invalidated waits cannot indefinitely block a newly armed schedule. An already-issued command cannot be undone; after invalidation no subsequent command is admitted. Preserve cron/interval selection, minimum interval, warning formatting/order and skip-on-stopped behavior.

### R7 — parser errors stop dispatch

Throw/reject from the parser error boundary; setting `ctx.status` and returning from `onError` alone still permits dispatch. Normalize known malformed JSON failures to 400 and payload-size failures to 413 with generic client messages. Keep handling local to parsing; propagate unrelated failures with their existing classification.

Preserve session/precheck ordering, panel parsed methods (GET/PUT/POST/DELETE), daemon default parsed methods, 10 MiB JSON limit, multipart limits (daemon 100 MiB; panel 500 MiB; one file), successful body/file shapes and ordinary application error responses. In particular, retain the panel's typed security error bridge and ordinary application 500 handling. Do not wrap downstream application execution in a catch that reclassifies every error as a parser failure.

## Completed work to preserve

- The historical card-view Select All no-op is fixed; R2 corrects its union of active and inactive sources.
- `InstanceList.vue:refreshVisibleInstances` already fences background endpoint refresh by generation, node, query and mount state and skips batch mode. Reuse those boundaries where appropriate; do not replace that working refresh loop.
- #3's timer/filter typings and local koa-body/Koa declaration boundaries are compatibility changes, not R4–R6 lifecycle fixes.
- #3 already records successful parser method/body/file-shape and real daemon upload/passport coverage; extend these checks.
- #3 records authentication hardening and a verified production bootstrap/chunk fix. Preserve those results and checks; their hosted Chrome and shipping-image gates passed in #3 run 40940013639. #4 needs its own final checks and CI.

## Acceptance and limits

Each defect needs an isolated behavioral regression that fails against the inspected behavior, then passes with its minimal fix. Use deferred promises and controlled clocks rather than wall-clock sleeps; assert requests, emitted commands, callbacks, visible state and live-resource counts. Include normal-operation controls and late failures as well as late successes. Exercise real source and mounted hooks/components or real HTTP middleware, with external services and destructive effects mocked.

Acceptance requires focused regressions, existing backend/account tests, daemon/panel builds, frontend type-check/build and the existing production boot smoke. Run browser checks with disposable fixtures; never issue real restart/delete operations. Record failures and unrun gates explicitly.

Out of scope: #5 layout/accessibility work, package/runtime upgrades, #3 session redesign, unrelated security/restore work, bundle optimization, backup consistency, comprehensive load testing, deployment or promotion. This documentation sidecar ran no suites/builds; the [results record](../plans/2026-10-29-reliability-hardening-results.md) records parent-supplied verification and pending gates.


## Current verification checkpoint

Parent-reported strict Linux Node 24.22.2 backend security: **272/272, zero skips**; daemon/panel builds remain final stable passes. The R3 author reproduced **8 failures** before correction; focused checks now pass **51/51 (39 file-manager + 12 upload)**, including failure, switchback, Windows-path and default-tab cases. The other **41 R2/R4/R5** tests remain passing. The full frontend reliability suite passes **92/92** on Linux after the final R3 correction. Full `npm run build --prefix frontend` passes, including type-check and Vite production build (16.11 seconds). No further application changes are planned. A test-fixture type failure was fixed without casts or compiler changes; Windows frontend type-check passes. The actual compiled cold-browser helper passes with isolated Edge at 1440 light and 390 dark: Vue/login true, zero page errors, and all 14 assets HTTP 200 in each case. #4 local verification is complete. Commit/push, #4 remote CI and GHCR publication have not occurred; main is unchanged. #4 actual shipping-image and hosted-Chrome gates remain unverified until CI. See the [results](../plans/2026-10-29-reliability-hardening-results.md) before claiming acceptance.
