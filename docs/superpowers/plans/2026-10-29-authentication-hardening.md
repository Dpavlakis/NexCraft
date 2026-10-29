# Authentication hardening — implementation and verification record (audit #3)

Date: 2026-10-29. Checkout: D:/Projects/NexCraft, branch test.
Status: #3 source `673783fd` and readiness follow-up `4fd56431` passed hosted CI, including Chrome cold boot and both actual Docker final-image gates. No #3 GHCR dispatch has occurred; main is unchanged. The parent will publish #3 and #4 together after #4 CI passes.
Contract: [authentication specification](../specs/2026-10-29-authentication-hardening.md).

## Delivered behavior

- Bounded process-memory sessions carry opaque signed IDs. Documented store/genid/externalKey hooks rotate ID/token on login; absolute TTL, current-user fingerprint checks and generation fencing reject replay and late resurrection. Ordinary overlapping requests remain successful; protected SSO transitions use separate revisions and consume state before provider awaits.
- The production installer validates sessions before upload precheck and parsing. A narrow outer bridge preserves typed HTTP error envelopes for final session commits. Default autoCommit handles persistence; explicit production Session.save calls were removed.
- User writes serialize per user and clone/persist/publish. User files use temporary-file replacement; Redis remains a single-record operation. Ambiguous writes quarantine authentication against the original backend until authoritative recovery. Self-password change preserves 2FA; admin recovery clears it. Credential/factor changes revoke all browser sessions/setups while ordinary API-key policy remains intact.
- Five-minute 2FA setups belong to one exact session/generation/user and remain outside the active User secret. Current password or fresh verified provider proof starts enrollment; replacing/disabling an active factor also requires its current TOTP. Confirmation verifies the new secret, persists both factor fields, consumes setup and revokes sessions. Attempt caps, cancellation, stale response protection and expiry apply; sweeps erase expired secrets.
- Sensitive self-service rejects API-key carriers even alongside cookies. Account UI masks passwords, distinguishes current/new factors, supplies expiry/cancel/restart/error states, clears secrets and routes committed security changes to sign-in. Sensitive API calls bypass response caching; token logs were removed.

The implementation resides in panel authentication/session/security/User services, their middleware/routers and User file storage; frontend account/API components and English strings; and scripts/security-tests/authentication-backend.test.cjs. Existing router fixture adapters preserve their assertions.

## Review corrections

Immediate logout is independent of disk and the User lock. Deterministic held-write tests show logout HTTP 200 and copied-cookie /auth/token HTTP 403 before releasing theme/password/factor writes. Waiting sensitive operations revalidate. Already-authorized storage commits may finish without restoring authentication.

Deletion fences authentication before backend I/O. Lost Redis DEL acknowledgements before/after commit return 503 and retain quarantine on the original backend. A successful authoritative reload with no record removes the stale in-memory account; unavailable/invalid reload fails closed. A definite failure retains the committed account while leaving previous sessions/setups revoked. Recovery through public password login or a verified provider callback never revives old cookies or setups.

Seven added regressions cover deletion ambiguity/definite failure and four held-write logout cases. All 53 authentication tests are integrated.

## Verification coverage

Mounted tests use real HTTP, Koa/router/session middleware, cookie signatures, permission/identity checks, bcrypt/legacy MD5 and TOTP. Provider, storage, log and clock boundaries are isolated. Redis command failures are injected; no live Redis network-fault experiment is claimed.

| Area | Verified behavior |
| --- | --- |
| Replay and concurrency | Exact cookie/token replay fails after logout, credential/factor changes, expiry, eviction and restart; late saves cannot recreate entries. Eight ordinary overlapping requests and same-millisecond admission succeed. |
| Sessions and SSO | Fixed TTL/capacity, rotation, legacy-cookie rejection, invalid/deleted/banned users, protected-state revisions, final-commit error envelopes and unusable failed-issuance cookies. Verified provider provenance survives rotation; fabricated/expired proof fails. |
| API keys | Ordinary role/ownership authorization remains; sensitive key-only and key-plus-cookie requests fail. Explicit key rotation/disable and administrator recovery remain. |
| 2FA | Active factor survives start, wrong codes, cancel, expiry, QR and definite persistence failures; committed replacement changes actual TOTP login behavior. Ownership, stale IDs, attempt caps and racing operations are covered. |
| Persistence | Definite write/rename failures preserve committed state; ambiguous write/delete acknowledgements quarantine; authoritative recovery and confirmed-missing-record handling fail closed. |
| UI and logging | Rendered proof fields/payloads, replacement labels, expiry/cancel/error/relogin, fresh SSO guidance and stale async suppression; no raw credentials, token, ID or factor seed logs. |

| Recorded environment | Result |
| --- | --- |
| Windows Node 24.16.0, koa-session 6.2.0, koa-body 6.0.1 | Auth 53/53; auth + mod-target + game-endpoint 103/103; panel tsc --noEmit passed |
| Linux Node 24.22.2, npm 11.19.1, koa-session 7.0.2, koa-body 8.0.1, TypeScript 5.9.3 | Auth 53/53; focused combined 103/103; panel tsc --noEmit passed |
| Final integrated Linux source, strict unhandled rejections | Root security 256/256 (190 prior + 53 auth + 13 dependency); daemon/panel builds pass |
| Final frontend | Vitest 4.1.12 account/iframe 26/26; full type-check/build pass after seven explicit callback types |

No tests were weakened. Historical Windows session-6 evidence predates the completed lockfile-fresh local install. The updated Windows development preview passed an expanded sample capture without runtime/network errors at http://localhost:4180/; that sample is not exhaustive route coverage.

For reproducible focused coverage, the existing root security runner discovers authentication-backend.test.cjs. The focused command is:

```sh
node --unhandled-rejections=strict --test scripts/security-tests/authentication-backend.test.cjs scripts/security-tests/mod-target.test.cjs scripts/security-tests/game-endpoint.test.cjs
```

## Release gates and follow-up

The [runtime results](2026-10-29-runtime-dependency-hardening-results.md) record the compiled production login, Instances/account/chart checks and negative controls. Docker final-image and hosted Chrome CI gates passed in run 40940013639; see the hosted CI outcome below. No #3 GHCR dispatch has occurred; main is unchanged.

Malformed/oversized JSON parser log-and-continue HTTP 200 behavior predates #3. #4 implements fail-closed rejection; see its [verification status](2026-10-29-reliability-hardening-results.md) for outstanding gates. Broader design/UserList work and Modpack/Custom sections remain queued for #5. Multi-process sessions and retroactive daemon-capability revocation are outside this implementation.

## Hosted CI outcome and publication status

[Successful #3 CI run 40940013639](https://github.com/Dpavlakis/NexCraft/actions/runs/40940013639) passed on Node 24.22.2: security 256/256, account/iframe 26/26, daemon/panel/frontend builds, hosted Chrome cold boot, both actual Docker image builds, runtime/npm/common links, Java/shared libraries, fresh HTTP startup and SIGTERM exit 0. Source was `673783fd`; follow-up `4fd56431` added bounded HTTP readiness retries. [Initial run 40939107627](https://github.com/Dpavlakis/NexCraft/actions/runs/40939107627) failed only because its startup probe reset roughly 0.3 seconds after launch; that initial run did not pass. These outcomes are parent-supplied evidence.

No #3 GHCR dispatch has occurred; main is unchanged. The parent integrates, reviews and tests, then commits/pushes `test` and dispatches GHCR after successful #4 CI so #3 and #4 publish together. Promotion to `main` requires manual acceptance. Nonblocking action-metadata annotations report Node 20 actions under forced Node 24; #27 now queues a refresh to verified action versions, with no action major bumps in this batch.
