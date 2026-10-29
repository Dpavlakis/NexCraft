# Authentication hardening — implemented contract (audit #3)

Date: 2026-10-29. Checkout: D:/Projects/NexCraft, branch test.
Status: Code `7d66bb8b` pushed to `test`; #4 CI passed all 390 tests and build/browser/image/runtime gates. Combined #3/#4 GHCR publication requested; completion unverified. Main is unchanged.

This contract addresses replayable browser sessions, credential/factor invalidation and unsafe 2FA replacement. Browser sessions are revocable server-side records; replacement secrets are staged until verified and persisted. The following sections define the implemented guarantees.

## Implemented session contract

The implementation uses koa-session's external store with bounded process-memory state and random signing keys/cookie name per boot. The signed cookie contains only an opaque cryptographically random session ID; all session payload, token, SSO proof and pending 2FA state stay server-side. No durable session database or new persisted user revision is required.

- Absolute authenticated lifetime: 24 hours from successful login; anonymous/SSO-flow lifetime: 10 minutes. No sliding extension through store.set or the library's extra TTL grace.
- Maximum 2,048 stored sessions, including at most 1,024 anonymous sessions, at most 10 authenticated sessions per user, and 32 KiB serialized payload per session. Sweep expired entries every minute and on admission; unref the timer. Unpopulated requests allocate no persistent record.
- At the per-user limit, a successful new login evicts that user's oldest session. Global/anonymous capacity exhaustion returns 503 without evicting unrelated authenticated sessions. Reject oversized state explicitly.
- App bootstrap injects current-user lookup, avoiding a store import cycle with passport_service/user_service.
- Store an immutable fingerprint of canonical [uuid,passWordType,passWord,open2FA,secret] when authentication succeeds. On every get and set, require an existing, enabled current user and matching fingerprint. Refresh identity/role from that user. API keys remain an independent authentication mode.
- On every committed password/factor change, synchronously revoke all that user's browser sessions and pending setups through an injected callback. Fingerprint checks are a second boundary. Eager revocation also prevents an A→B→A factor change from reviving an unused old session.
- Successful login creates a fresh ID and token, destroys the previous ID, and drops old authentication/pending setup state. Preserve only explicitly needed SSO flow data until its consumption. Password login, installation, OIDC/OAuth2 callback, SSO bind and exchange SSO must all use this issuance path.
- Logout synchronously destroys the server entry and its pending setup, without acquiring the User persistence lock, before returning success and expiring the cookie. Repeating logout succeeds idempotently. It revokes the current session only. Password changes and factor changes revoke every browser session of that user.
- Self-password change preserves the existing active factor. Admin password reset retains the current explicit recovery policy: clear secret and open2FA, invalidate all target sessions and setups. Ordinary admin/profile edits do not reset factors or sessions.
- Restart starts with an empty store and new signing keys; everyone signs in again. Neither old cookies nor pending QR codes are restored. Legacy signed payload cookies are never decoded/imported as authenticated state; one-time relogin is acceptable.

### Mandatory late-write protection

A map delete followed by an unrestricted set is insufficient. Each store.get captures the exact entry identity/generation and protected-state revision in request-local server metadata. A later set may update only that still-live entry/generation, with valid expiry and fingerprint. Missing, destroyed, expired, evicted or credential-invalid entries must never be recreated by a late writer. Deep-copy session payloads at get/set boundaries.

Only an explicit server-issued new-session capability held in request-local metadata can create a record. Never infer create permission from a missing ID, JSON fields, isNew, a client cookie or a request token. Consume that capability once. No unbounded tombstone list is needed.

Concurrent ordinary authenticated requests must all succeed: SESSION_REQ_TIMES saves are dropped; admission is counted atomically in the server entry, preserving distinct same-millisecond requests. Ordinary bookkeeping never overwrites newer protected state. Use entry identity/generation fencing for every save. Only a stale protected SSO/security transition returns 409; ordinary polls never fail because another poll saved first. Missing/revoked entries discard late ordinary saves without recreating them. Protected transitions and login rotation require a still-live source generation and current protected-state revision; consumed SSO state is committed before awaiting a provider so concurrent callbacks cannot reuse it. Sensitive transitions revalidate under the per-user operation lock before committing. Already authorized ordinary work may finish after revocation; its late save cannot restore authentication.

The adapter uses documented genid, store hooks and externalKey get/set with a request-local selected write/cookie ID. Store writes and cookie emission use that selected ID. Mounted tests verify rotation on koa-session 6.2.0 and the integrated 7.0.2. Default autoCommit:true persists at middleware completion; production authentication/SSO does not call Session.save(). Final commit errors reach the outer typed error bridge.

### Central authentication boundary

Middleware order is outer typed session-error bridge, external-session middleware, upload precheck, koa-body, then existing prefix/protocol/router processing. This preserves upload rejection before parsing while loading/validating the session before every consumer.

Store get must remove invalid authentication before any middleware/router sees ctx.session, including token:false and public-level routes, getUserFromCtx, upload precheck, limit/concurrency middleware, SSO bind-current and session role passed to daemon operations. Identity helpers must require a live validated browser session when not using an API key; no raw uuid fallback. Recheck freshness for sensitive operations.

Use a narrow outer error bridge because koa-session final commit runs outside the existing inner protocol middleware. Only typed store/session errors need the existing {status,data,time} envelope there; do not rewrite unrelated error handling. Preserve existing AJAX/query-token and API authorization behavior for ordinary endpoints.

Panel Socket.IO business routing remains disabled in socket_router.ts. Existing daemon terminal/file capabilities use HTTP authorization; prevent revoked sessions minting new ones. Previously issued daemon capabilities and already running work are not retroactively cancelled by this batch.

## Exact sensitive API contract

All paths below are under /api. Sensitive self-service requires a live browser session, current user, AJAX header and matching session token. Reject requests carrying either API-key parameter/header, even with a valid cookie, before credential checks or side effects. API keys cannot substitute for proof.

For 2FA operations, credential proof means either currentPassword or recent verified provider SSO proof stored by the server in this authenticated session, no older than five minutes. The latter is issued only after a completed verified OIDC/OAuth2 callback; retain this provenance through that callback's successful login rotation. Exchange SSO tokens, SSO claims in request bodies, passwordless bind-current, API keys and possession of an ordinary session do not create this proof. Always require the currently active TOTP as well when disabling or replacing an enabled factor. This explicitly supports SSO-only users who do not know their generated local password.

| Endpoint | Request body | Success data and behavior |
| --- | --- | --- |
| PUT /auth/update | {passWord,currentPassword,currentTOTP?,isInit?} | true; validate existing password policy, require current local password and active factor if enabled; persist, revoke all browser sessions, clear current cookie. |
| POST /auth/bind2fa | {currentPassword?,currentTOTP?} | {setupId,qrcode,expiresAt,replacing}; credential proof as above; active factor required for replacement. |
| POST /auth/confirm2fa (enable) | {enable:true,setupId,TOTPCode} | {enabled:true,reloginRequired:true}; TOTPCode verifies the staged NEW secret. Start proof is valid only for this session/setup's five-minute lifetime. |
| POST /auth/confirm2fa (disable) | {enable:false,currentPassword?,currentTOTP} | {enabled:false,reloginRequired:true}; verify credential proof AND current factor, then clear active secret/factor and revoke sessions/setups. No dummy code fallback. |
| DELETE /auth/bind2fa | {setupId} | true; cancel only the matching current-session setup; already absent is idempotent and cannot cancel another setup. |
| PUT /auth/api | {enable,currentPassword?,currentTOTP?} | Existing string response (new key or empty string); require the same credential proof and active factor if enabled. |
| POST /auth/sso/bind-current | Existing body | Existing response; require browser session plus existing verified pending provider binding, preserving its present interactive SSO policy. An API key cannot invoke it. |

First enrollment accepts password OR fresh server-recorded provider proof. Replacement/disable require that proof plus the existing factor; SSO alone cannot remove a local factor. If provider proof has expired, ask the user to complete SSO sign-in again and return to setup. Self-password change deliberately still requires the existing local password; SSO users without it use existing admin password recovery. Do not silently weaken this into a session-only password reset.

All new proof/setup fields have strict primitive validation and explicit allowed lengths; TOTP strings are exactly six decimal digits. Confirm bodies are a discriminated union. Missing required proof is rejected, not treated as old-client compatibility. Current-password checks retain bcrypt and legacy MD5 support and do not enforce new-password complexity on an existing password.

Use 400 for invalid shapes/new-password policy, 403 for authentication/proof/API-key rejection, 409 for busy/conflicting state or stale setup, 410 for expired setup, 429 for exhausted proof/setup attempts, and 503 for capacity/persistence availability. Use the existing {status,data,time} envelope, with a localized string for error data. Never return false/undefined for these failures: the existing protocol converts those into 500.

Ordinary API-key endpoints retain current role/ownership rules and key format. Logout, password changes and 2FA changes do not silently rotate existing API keys; explicit key rotation/disable remains available. Admin API keys retain their existing admin reset capability. Key-only access to sensitive self-service routes is intentionally rejected.

## 2FA state, persistence and concurrency

One pending setup per user is owned by exact session ID/generation and user UUID, with random setupId, new secret, creation/absolute expiry, starting credential fingerprint and failed-code count. It lives only in a dedicated bounded server-side store, never User.secret, signed cookie, generic profile data or frontend persistent storage.

Expiry is five minutes; maximum five wrong confirmation codes per setup. Allow five proof/start attempts per five-minute user/session window, counting failed attempts; enforce server-side, including for admins. Store limiter buckets only for existing users/live sessions with fixed expiry and bounded size. Pending count is bounded by authenticated users/sessions; expiry cleanup shares the store sweep.

Starting a fresh setup replaces that user's earlier pending setup only after valid proof and successful QR generation. Existing enabled secret/open2FA remain untouched through start, cancellation, expiry, generation error and incorrect new codes. Generate QR with NexCraft issuer text. QR/secret responses use Cache-Control: no-store.

Confirmation rechecks current session, owner, setup ID, expiry, fingerprint and attempt limit, then validates the new TOTP using an isolated authenticator instance. It publishes secret+open2FA=true as one persisted user update, consumes setup and revokes browser sessions. Old QR/setup IDs cannot confirm, cancel, disable or overwrite a later setup.

Serialize competing start/confirm/disable/password/admin-reset/user-write transitions by user with bounded operation state and correct lock lifetime. Re-read current user and session under the lock; do not trust a request's earlier snapshot. Concurrent confirmations have at most one successful commit. No queued stale confirmation can undo disable/reset or resurrect a cancelled setup. Release lock state after all holders/waiters finish; cap outstanding operations and return 409 when busy.

Persistence is of credentials/factors only, through the existing file/Redis User backend. User writes clone, persist, then publish, preserving existing field whitelist/validation behavior. Coordinate other User writers (including SSO binding) so stale full-record writes cannot restore old credentials. Use an atomic temp-file/rename write for panel User records; Redis SET is already a single-record operation. No common/daemon storage refactor or new database.

Definite pre-commit failure keeps the last committed password/factor, returns an error, and never claims success or disables the old factor. A failed confirmation retains a still-valid pending setup for retry unless its owner has meanwhile logged out or been revoked. Ambiguous write outcome quarantines that user's authentication and drops sessions/setups until authoritative reload succeeds; never republish an assumed old state or switch backend to report success. Restart must either load a valid committed user or fail closed. Logout itself needs no persistence.

Step-up resolves the current user explicitly and uses side-effect-free password/factor proof helpers with isolated TOTP options. It does not reuse checkUser, which returns without throwing for unknown names and checks factor before password, or check2FA, which mutates global authenticator.options. Existing login ordering, error semantics, password policy, ban/IP counters, SSO login policy and unrelated permissions are preserved. Enabled 2FA with an absent secret fails sensitive operations closed.

## Implemented account UI contract

MyselfInfoDialog provides labelled current-password/current-factor proof fields and fresh-SSO/sign-in-again guidance. Current/new/confirmation password inputs use a-input-password and appropriate autocomplete. UserList masking/layout remains queued for #5.

Show “Current authenticator” separately from “New authenticator code”. Replacement states that the current authenticator remains active until confirmation. Show expiry, cancel/restart controls, separate loading states and actual server errors. Disable cannot submit a hard-coded code. Clear sensitive fields/QR on cancel, close, logout, expiry and success. Ignore late responses from earlier setup requests/dialog instances. Never refresh open2FA optimistically after start. On committed password/factor change show “Security settings updated. Sign in again.” and follow existing login/SSO routing.

Sensitive API definitions and calls bypass the frontend's two-second response cache with forceRequest:true, keeping proof/QR responses out of responseMap. Raw login and exchange SSO token logging is removed; non-secret audit events remain.

## Final review fixes and verification

Logout revokes the current browser entry and its pending setup immediately, without waiting for the User operation lock or disk. Waiting sensitive work revalidates under the lock. A write already authorized and handed to storage may finish; logout cannot roll it back or recreate its session/setup.

Uncertain account deletion fences authentication and revokes sessions/setups before awaiting the original backend. Lost acknowledgements return typed 503 with an unconfirmed-deletion message and keep authentication quarantined. Authoritative reload stays pinned to that backend; a confirmed missing record removes the stale User and clears quarantine. Unavailable/invalid reload fails closed. Definite pre-commit deletion failure retains the committed account, with prior sessions/setups revoked. Password login and verified provider callbacks can attempt authoritative recovery without a live administrator session.

Expiry sweeps erase pending secrets, keeping only bounded owner/setup-ID markers for precise 410 responses. Revocation removes the owner's setup. All 53 authentication regressions are integrated, including the two review-confirmed logout/deletion issues.

| Verification environment | Recorded result |
| --- | --- |
| Windows Node 24.16.0, koa-session 6.2.0 / koa-body 6.0.1 | Authentication 53/53 |
| Linux Node 24.22.2, npm 11.19.1, koa-session 7.0.2 / koa-body 8.0.1 | Authentication 53/53 |
| Final combined Linux run, strict unhandled rejections | Root security 256/256: prior 190 + 53 auth + 13 dependency |
| Frontend Vitest 4.1.12 | Account/iframe 26/26 |
| Final source builds | Daemon/panel builds and full frontend type-check/build pass |

The Windows 6.2.0 run is historical compatibility evidence. Actual Windows node_modules have since been refreshed from the final locks, including Vue 3.5.44, vue-i18n 11.4.16 and Vite 7.3.7. No tests were weakened.

See the [implementation and verification record](../plans/2026-10-29-authentication-hardening.md) and [runtime results](../plans/2026-10-29-runtime-dependency-hardening-results.md) for production browser evidence and the completed #3 CI gates. Multi-process shared sessions, reverse-proxy/TLS cookie redesign, retroactive daemon-capability revocation and general authentication cleanup remain outside #3. At the #3 baseline, malformed/oversized JSON parser callbacks logged and continued with HTTP 200. #4 implements rejection handling; its local verification is complete, with remote CI passed and combined publication requested in the [reliability results](../plans/2026-10-29-reliability-hardening-results.md). Broader design, including Modpack/Custom sections, remains queued for #5.

## Hosted CI outcome and publication status

[Successful #3 CI run 40940013639](https://github.com/Dpavlakis/NexCraft/actions/runs/40940013639) passed on Node 24.22.2: security 256/256, account/iframe 26/26, daemon/panel/frontend builds, hosted Chrome cold boot, both actual Docker image builds, runtime/npm/common links, Java/shared libraries, fresh HTTP startup and SIGTERM exit 0. Source was `673783fd`; follow-up `4fd56431` added bounded HTTP readiness retries. [Initial run 40939107627](https://github.com/Dpavlakis/NexCraft/actions/runs/40939107627) failed only because its startup probe reset roughly 0.3 seconds after launch; that initial run did not pass. These outcomes are parent-supplied evidence.

Code commit `7d66bb8b` was pushed to `test`. [#4 CI run 40942055728](https://github.com/Dpavlakis/NexCraft/actions/runs/40942055728) passed in full: **390 tests (272 backend, 26 account/iframe, 92 reliability)**, daemon/panel/frontend type-check/build, hosted Chrome, both actual Docker image builds, final runtime/common/npm/Java/shared-library checks, fresh HTTP startup and SIGTERM exit 0.

Combined #3/#4 GHCR publication was requested successfully with `gh workflow run docker.yml --ref test --repo Dpavlakis/NexCraft`: [publish run 40942868091](https://github.com/Dpavlakis/NexCraft/actions/runs/40942868091). Dispatch success does not establish build completion; completion was not watched or claimed. Main is unchanged. After the workflow turns green, update both existing Web and Daemon containers and sign in again because browser sessions are process-local. #5 waits for the user's live test; promotion to `main` requires manual acceptance. Nonblocking action-metadata annotations report Node 20 actions under forced Node 24; #27 now queues a refresh to verified action versions, with no action major bumps in this batch.

The parent will commit/push this documentation-only checkpoint after the publish run started. The publish head is code-validated `7d66bb8b`; these documentation files are not copied into the images.
