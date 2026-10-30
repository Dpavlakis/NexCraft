# Navigation throttling fix — final approved policy

**USER APPROVED: no generic throttle for ordinary authenticated panel use.** This policy supersedes the earlier 24/32/48-capacity experiments and the 48-request hotfix in f56a2dc3. The signed-in token bucket is removed, not enlarged. Reads, preference writes, instance actions, icon credentials and terminal stream credentials all bypass generic admission after live store-backed identity validation. No route allowlist, path matching, new limiter or authentication threshold is introduced.

Actual checkout: `D:/Projects/NexCraft`, branch `test`. GHCR remains on HOLD pending the parent's independent authentication coverage, complete suite/build/CI and release decision. This bounded correction does not commit, push or publish. Earlier publication checkpoints are historical and do not authorize release of this correction.

## Admission and authorization

`SessionStore.admitRequest` first validates the request's original store entry. Authenticated entries bypass only when `user(ctx)` confirms the live entry, account, credential fingerprint, matching UUID and `login === true`. Expired, revoked, evicted, deleted, banned or credential-stale entries cannot use copied session JSON to bypass admission or recreate a session through late saves. Generic bypass does not bypass permission's API-key, Ajax, token or live role checks. Existing explicit `speedLimit: false` routes retain their behavior.

Anonymous browser entries retain their store-owned sliding window of eight requests per second, including equal-clock concurrent requests; fresh anonymous sessions retain the existing fallback accounting. API keys retain existing checks and admission behavior. No ordinary authenticated request counter or token-bucket state remains.

## Authentication route inventory and retained protections

- `POST /api/auth/login`: actual credential verification remains anonymous-limited. A live signed-in session already returns `Logined` before verifying submitted credentials. Existing `checkBanIp`, login failure accounting and password/TOTP verification are unchanged.
- `/api/auth/install`: retains anonymous admission and existing installation/validation checks; existing accounts prevent credential creation. No extra limiter is needed for an already authenticated request.
- SSO `/api/auth/sso/authorize`, `/callback` and `/bind`, and instance exchange public routes retain anonymous generic admission plus their existing IP, state, expiry, provenance, credential and capability protections. Live authenticated sessions use the same store-verified bypass; no route implementation changes were necessary.
- `/api/auth/update`, `/api/auth/api`, `/api/auth/bind2fa` and `/api/auth/confirm2fa` retain `sensitivePermission` and their independent proof service, including five current-proof attempts per 300000ms and existing setup/new-code controls. Proof limits neither consume nor depend on ordinary admission. SSO bind-current retains its existing sensitive-browser/proof handling.
- `/api/auth/avatar` and `/api/auth/theme` are ordinary preference writes and bypass generic admission. `/api/auth/token`, `/api/auth/`, logout, status and login_info retain their explicit existing speed-limit exemptions. Admin routes retain existing role checks/exemptions.

## Focused regression contract

1. Repeated simultaneous waves of 128 signed-in requests at one frozen clock, totaling 512 ordinary requests, all succeed. Concurrent avatar/theme writes also succeed. Wrong tokens and insufficient roles still fail.
2. The actual default 20-card page mounts through existing frontend components, API/cache and actual backend routers. Initial navigation plus repeated navigation at the same store clock completes 94 HTTP calls with all credentials succeeding once per intended action, 20 resolved provider pills and no mounted errors. Frontend sources/services/tests are not edited.
3. Anonymous admission remains eight per sliding second. Actual anonymous login reaches its unchanged ninth-request 429 with Retry-After: 1, while already signed-in login exits successfully even with an incorrect submitted password.
4. After 512 ordinary requests, five wrong current TOTP proofs fail with 403; the sixth reaches the independent proof-specific 429. An ordinary one-second cooldown cannot reopen proofs; the existing proof cooldown does.
5. Revocation, bans, fingerprint changes, deletion and expiry occurring after session load but before permission cannot obtain the bypass. Existing stale-save checks after logout, password change, admin reset, expiry and eviction remain covered, along with API-key behavior and fixed TTL.

## Historical measurements and existing frontend work

The initial eight-request blanket limit rejected ordinary page/navigation fanout. Capacities 24 and 32 still rejected single-attempt credentials in the mounted default 20-card workload; 48 admitted one bounded 44-request charged fanout but remained a blanket throttle. Those sizing policies and exhaustion/refill expectations are superseded by the approved removal above.

Earlier hotfix work added bounded recovery for five safe GET endpoints, independent cancellation ownership and session/cache publication fences. Existing mutation/credential no-replay behavior and frontend recovery implementation remain unchanged by this backend correction. Earlier visual previews and integration results describe that prior work, not validation of this final policy.

## Bounded ownership and validation

Only session_store.ts, permission.ts, the two security regression files and this canonical spec/plan are edited. Authentication.ts and login_router.ts need no edits. Existing unrelated UI/Java/workflow changes remain intact. Use installed dependencies and focused tests only; full suite/build/CI and independent auth coverage belong to the parent. No agents, packages, deployment, live MC/NAS access or Git mutations.

## Parent integration validation

The approved correction passed all 318 backend regressions locally, with zero failures or skips. The panel compiled successfully and frontend type checking passed. This local backend total includes the separate pending Java work; clean committed-source hosted CI validates the Web-only publish subset independently. Review confirmed the only product changes in this correction are removal of authenticated bucket state and the live identity admission bypass; no route, proof, login, API-key, token or role policy was weakened. Publishing remains conditional on the required clean-source CI gates. The user's approval covers this correction and the test image publication; the unrelated design/Java batch remains local for visual approval.
