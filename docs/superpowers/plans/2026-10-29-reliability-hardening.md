# Reliability hardening — implementation and verification record (audit #4)

Date: 2026-10-29. Status: source and final R3 correction implemented and independently reviewed; local verification complete; #4 commit/push, remote CI and GHCR pending. Main is unchanged.
Evidence: [results and pending gates](2026-10-29-reliability-hardening-results.md).
Contract: [specification](../specs/2026-10-29-reliability-hardening.md).
Baseline checkout: `D:/Projects/NexCraft`, `test`, HEAD `673783fd23aed0bd42dc0214e98b999a70472049`.

## Execution boundaries

Finish #4 fixes and tests before #5 design. Re-read standing instructions and the current diff in this shared checkout; preserve unrelated changes. Standing user authorization is Sol6.1 subagent execution. No-recursion/no-commit instructions constrain assigned workers, not the human or parent. The parent integrates, reviews and tests, commits/pushes `test`, and dispatches GHCR after #4 CI passes; #3 and #4 publish together. `main` changes only after manual acceptance. This sidecar owns only its assigned documentation; it does not run suites/builds or perform source, package, commit or push actions.

Use full-path PowerShell with `-NoProfile` (tool `login:false`) and explicit workdir. The configured `D:/NexCraft` is absent; do not create a replacement checkout. Request tool escalation only when access to the relocated checkout requires it.

For each implementation task: reproduce the failure with the named behavioral test, make the smallest fix, run its focused tests and inspect the diff against the specification. Use actual source; do not replace it with a duplicate implementation or rely on text/regex assertions. Do not mark a task done on compilation alone.

## Delivered implementation checklist and repeat verification

Sections 1–7 retain the task contracts and repeat-verification instructions. Source and regression coverage have been delivered and independently reviewed. The final R3 correction is complete and parent-reviewed; the final full frontend suite, production build and compiled browser verification pass. Local verification is complete; remote CI/publication remain pending. They are not seven outstanding design tasks. Exact completed checks and pending gates are in the [results](2026-10-29-reliability-hardening-results.md).

## 1. Targeted runners

**Delivered files:** `frontend/src/reliability-tests/reliability.config.ts`, `frontend/src/reliability-tests/helpers.ts`; extend `.github/workflows/security-validation.yml` only to run the new frontend suite.

- Reuse installed Vitest, Vue and jsdom, following `src/components/__tests__/account-security.config.ts`: Vue plugin, `@` alias to src, jsdom, one worker, no production config or package changes. Include only `src/reliability-tests/*.test.ts`.
- Use Vue's installed createApp/defineComponent mounted-host pattern; do not assume Vue Test Utils is present or add packages. Provide only reusable deferred-promise/microtask helpers and a tiny mounted-hook host. Reset mocks, singleton upload state and fake timers after each case; unmount every host. No general lifecycle framework.
- Place backend regressions in existing `scripts/security-tests/*.test.cjs` discovery; use the existing ts-node/source-loading conventions. Mock scheduling, sleep, sockets and instance commands; HTTP listeners use loopback ephemeral ports and owned temporary directories.
- Add a frontend reliability step alongside existing account/iframe checks; retain full backend discovery, all builds, production smoke and shipping-image gates. Verify the new suite actually discovers its tests.

**Repeat verification:** from frontend, `node node_modules/vitest/vitest.mjs run --config src/reliability-tests/reliability.config.ts`.

## 2. R1 — recover upload initialization failures

**Source:** `frontend/src/services/uploadService.ts`.
**Tests:** `frontend/src/reliability-tests/uploadService.test.ts`.

- Centralize idempotent failed-entry removal and advancement without treating initialization failure as a chunk retry or suspending healthy work. Handle temporary/server IDs and check queue membership before publishing late initialization.
- Hold A's initialization, enqueue B with a distinct identity, resolve B's configuration, then reject A. Assert B's chunk request starts, A is removed, its end callback/error occurs once, and successful-upload count remains unchanged until B completes.
- Cover a missing-ID response; queued B failing while A uploads; all entries failing; and stop during pending initialization followed by a new queue and late success/failure from the old queue. Assert no resurrection, unknown-current dereference, duplicate callback or chunk request.
- Normal controls: multi-chunk completion, resume offset, pause/resume, cancellation and existing retry limit/options. Avoid expanding this into a queue rewrite.

**Exit:** focused test passes and failure/removal cannot stall the next eligible entry.

## 3. R2 — keep batch selection attached to its owner

**Source:** `frontend/src/widgets/InstanceList.vue`.
**Tests:** `frontend/src/reliability-tests/InstanceList.test.ts`.

- Select from the active single-node page only. Track the data/selection's owning daemon and query generation; disallow cached rows while a new owner is loading. Invalidate selection on node/filter/page changes.
- Snapshot owner/UUIDs at admission; use the snapshot for all batch request formats. Guard delayed delete confirmation against a changed context. Retain current single-node controls and confirmation wording; no global batch UI.
- Mount the real component with mocked APIs/router and minimal UI stubs. Visit global mode to populate tree A/B, switch to node B, Select All, and assert only B's visible page UUIDs are selected and submitted.
- Hold B's fetch after switching from A: no A UUID can be submitted as B. Resolve old A after B to check ownership cannot silently change under the current node.
- Verify start/stop/restart/kill and both delete modes; duplicate UUIDs in inactive nodes must not affect selection. Open delete confirmation, switch node/page, then confirm: zero requests. Normal B selection submits B exactly once.
- Preserve `refreshVisibleInstances` generation/mount guards and current loaded-page semantics.

**Exit:** every submitted pair belongs to the selected page's daemon; obsolete confirmation submits nothing.

## 4. R3 — fence listing and navigation continuations

**Source:** `frontend/src/hooks/useFileManager.ts`.
**Tests:** `frontend/src/reliability-tests/useFileManager.test.ts`.

- Capture listing generation plus daemon/instance/tab/path/page/page-size/search at initiation; invalidate on navigation/tab removal/unmount. Guard listing/total/default-tab commits.
- Extend ownership to `handleChangeTab`, `handleChangeDir`, `toDisk` and their success/catch/finally paths. Keep listing-owned loading completion from clearing newer work; preserve unrelated upload/loading flows.
- Hold A, switch to B and resolve B then A: B's items/totals/tab/breadcrumbs remain. Repeat A → B → A and two identical refreshes in reversed order; generation must decide.
- Reject A after B is active: no breadcrumb rollback, rollback fetch, active-view toast or premature loading completion. Cover directory success after tab switch, closing a pending tab, search/page races and unmount.
- Normal controls: active directory failure still restores the prior path with its current error behavior; current success updates the original tab, search/pagination work and initial default-tab creation occurs once. Preserve Windows drive formatting and tab storage.

**Exit:** stale success and stale failure cannot mutate any current navigation state.

## 5. R4/R5 — prevent resources after teardown

**Sources:** `frontend/src/hooks/useInstance.ts`, `frontend/src/hooks/useTerminal.ts`.
**Tests:** `frontend/src/reliability-tests/useInstance.test.ts`, `frontend/src/reliability-tests/useTerminal.test.ts`.

- R4: mark the hook disposed during unmount and check after initial fetch before interval allocation. Keep the 3-second interval and current `autoRefresh` behavior; guard scheduled callbacks against disposal.
- Hold the initial fetch, unmount, settle it and advance fake time: only the original fetch occurred and zero polling timers remain. Test late rejection through the mounted host's error capture. Live controls: refresh at 3 seconds; no interval with autoRefresh false; existing interval cleared on unmount.
- R5: invalidate pending terminal setup at teardown; share same-target setup or fence overlapping attempts. Check before creating/connecting sockets and bind socket callbacks to their owner. Clean up obsolete socket results if allocation has already happened.
- Hold channel setup, unmount, resolve/reject: `makeSocketIo`/connect/auth are never called and no post-teardown event is emitted. Repeat mount/unmount cycles and assert no timer/socket growth.
- Resolve two overlapping setups in reverse order: at most one valid socket survives; different targets cannot share authorization. Trigger an obsolete socket callback and assert it cannot send authentication through or mutate a newer socket. Live controls retain auth/detail/stdout events, reconnect and existing timer periods; cleanup disconnects/removes listeners.

**Exit:** disposal always wins over late setup, and successful live behavior is unchanged. Timer type declarations alone do not satisfy this task.

## 6. R6 — invalidate active restart countdowns

**Source:** `daemon/src/service/scheduled_restart_service.ts`.
**Tests:** `scripts/security-tests/scheduled-restart.test.cjs`.

- Carry schedule/sequence identity through cron/interval callbacks and awaited countdown steps. Invalidate on cancel/reapply even when there is no stored job; check identity/enabled/RUNNING before side effects and after awaits.
- Replace or augment the UUID-only overlap Set with identity-owned state. Old `finally` cleanup cannot remove the marker for a replacement sequence.
- Capture scheduled callbacks and use deferred sleep/command promises. Start a warning, disable through `applyForInstance`, release sleep: no further say/restart. Repeat direct cancellation, cancel while say is pending, replacement by another enabled schedule and a saved callback invoked after cancellation.
- Exercise old/new sequences interleaved: invalidate old, start new, release old, then fire another new-generation callback. Assert the new run remains protected from overlap and old cleanup cannot unlock it.
- Controls: enabled uninterrupted cron/interval run emits expected warnings and exactly one restart; overlapping callbacks do not duplicate it; stopped instance is skipped/aborted. No real Minecraft process or scheduler waits.

**Exit:** a cancelled generation issues no new command and cannot interfere with its replacement.

## 7. R7 — reject parser failures at the production boundaries

**Sources:** `daemon/src/service/http.ts`, `panel/src/app/service/authentication.ts`.
**Tests:** update `scripts/security-tests/dependency-parser.test.cjs`; add `scripts/security-tests/parser-rejection.test.cjs` for mounted application boundaries.

- Make parser `onError` throw a correctly classified error (400 malformed JSON; 413 oversized JSON). Returning with a status/body is insufficient. Do not catch/relabel downstream application errors or change body-parser methods/limits.
- Replace the old explicit HTTP-200/undefined assertions with 400/413 and a downstream-handler call counter of zero. Retain actual configured parser methods, valid JSON/form requests, multipart fields/file shape and limit assertions. Keep the harness executing the real callback if implementation changes its dependencies.
- Mount real daemon `initKoa` and panel `installAuthentication` with isolated storage/router collaborators, following existing upload/auth fixtures. Send malformed JSON and one payload over the actual 10 MiB limit per backend; assert status plus no route mutation/RPC. Use scaled limits for additional overflow matrices to avoid large file allocations.
- Exercise production error ordering: valid JSON reaching an ordinary thrown application Error still produces the current 500 behavior; typed panel SecurityError retains its status/envelope. Do not install a test-only catcher that hides incorrect production handling.
- Keep valid multipart upload/passport and pre-parser unauthorized rejection tests. Check max-file/oversize rejection does not reach a mutation handler; close connections and remove only owned temporary files. No parser/package upgrade or session-store rewrite.

**Exit:** both real entrypoints fail closed while valid requests and existing application errors retain their behavior.

## 8. Integrated verification and handoff

Run each focused file during its task. After all pass, run the integrated commands once; repeat only for subsequent changes/failures. Use the approved installed Node/toolchain; do not install or refresh dependencies as part of #4.

PowerShell setup for each shell:

```powershell
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
Set-Location -LiteralPath 'D:\Projects\NexCraft'
git branch --show-current
git status --short
```

Expect `test` before implementation. Inspect concurrent changes; never reset or clean the shared checkout.

```powershell
node --unhandled-rejections=strict --test scripts/security-tests/scheduled-restart.test.cjs scripts/security-tests/parser-rejection.test.cjs scripts/security-tests/dependency-parser.test.cjs
npm run test:security
Push-Location -LiteralPath frontend
try {
  node node_modules/vitest/vitest.mjs run --config src/reliability-tests/reliability.config.ts
  node node_modules/vitest/vitest.mjs run --config src/components/__tests__/account-security.config.ts
} finally {
  Pop-Location
}
npm run build --prefix daemon
npm run build --prefix panel
npm run type-check --prefix frontend
npm run build --prefix frontend
```

Check every native command's exit code; PowerShell does not automatically stop on npm/node failure. Focus a frontend regression by adding its test path after the reliability config argument.

Run the existing production boot smoke against the new dist with an available local browser:

```powershell
node scripts/frontend-production-smoke.mjs --dist frontend/dist --browser '<absolute path to installed Chrome or Edge executable>'
```

Replace the browser placeholder with a verified installed path. If unavailable, record the missing local browser gate and retain the existing hosted gate; do not claim it passed.

Use disposable UI fixtures for: failed upload followed by a working upload; global → node Select All; rapid file-tab navigation; leaving instance/terminal before setup settles. Exercise restart disable/reapply through the isolated command spy, without a real restart. A successful build is not evidence for these races.

Review the final diff for unintended product/API/UI changes, package/lockfile changes and damage to #3's fixes. Record exact checks, results, remaining gates and changed files in the implementation handoff. #4 is complete only after behavioral regressions and required available checks pass; preserve any unrun CI/shipping-image gates explicitly. The parent owns commit/push and post-CI GHCR dispatch under standing authorization; workers hand off their scoped changes. Promotion remains gated on manual acceptance.


## Current verification checkpoint

Parent-reported strict Linux Node 24.22.2 backend security: **272/272, zero skips**; daemon/panel builds remain final stable passes. The R3 author reproduced **8 failures** before correction; focused checks now pass **51/51 (39 file-manager + 12 upload)**, including failure, switchback, Windows-path and default-tab cases. The other **41 R2/R4/R5** tests remain passing. The full frontend reliability suite passes **92/92** on Linux after the final R3 correction. Full `npm run build --prefix frontend` passes, including type-check and Vite production build (16.11 seconds). No further application changes are planned. A test-fixture type failure was fixed without casts or compiler changes; Windows frontend type-check passes. The actual compiled cold-browser helper passes with isolated Edge at 1440 light and 390 dark: Vue/login true, zero page errors, and all 14 assets HTTP 200 in each case. #4 local verification is complete. Commit/push, #4 remote CI and GHCR publication have not occurred; main is unchanged. #4 actual shipping-image and hosted-Chrome gates remain unverified until CI. See the [results](2026-10-29-reliability-hardening-results.md) before claiming acceptance.
