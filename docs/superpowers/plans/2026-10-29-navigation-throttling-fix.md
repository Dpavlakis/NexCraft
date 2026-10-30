# Navigation throttling fix â€” final bounded correction

**USER APPROVED: remove the generic throttle from ordinary authenticated panel use.** This replaces every earlier capacity-48 sizing/calibration plan. Historical 24/32/48 measurements establish the original symptom only; none defines the current policy.

Spec: ../specs/2026-10-29-navigation-throttling-fix.md

Actual checkout `D:/Projects/NexCraft`, branch `test`. GHCR HOLD remains in effect. Parent owns independent authentication coverage, complete suite/build/CI and any later release decision.

1. Read AGENTS.md/CLAUDE.md and follow the user's current checkout/test-only/direct-execution instructions where stale guidance conflicts. Inventory public login/install, SSO/exchange, preference and sensitive password/API-key/2FA routes before editing.
2. Remove authenticated requestBucket state and token-bucket accounting. Validate the original live store entry and `user(ctx)` before admitting an authenticated request without generic throttling. Preserve anonymous eight-per-second accounting, API-key/role/token checks, session revocation/conflict behavior, login IP protections and independent proof-five controls. No route flags, path matching, new thresholds or route/service policy edits are needed.
3. Replace authenticated exhaustion expectations with repeated 128-request simultaneous waves at one clock, ordinary writes, live-role/token checks and actual mounted default-page/navigation traffic beyond 48. Retain anonymous-cap tests and verify actual anonymous login remains capped while a live signed-in login already exits before credential verification.
4. After large ordinary traffic, verify the five-wrong-TOTP proof budget and independent cooldown. Recheck a loaded session after revoke/ban/fingerprint/delete/expiry before permission. Retain stale ordinary-save, TTL, API-key and role regressions.
5. Run only focused authentication/backend and mounted navigation checks using existing dependencies, then owned-file formatting and scoped whitespace checks. Record exact results below. Leave unrelated dirty UI/Java sources and parent API/recovery files intact. Do not commit, push, publish, install packages, dispatch CI or run a full build/suite.

## Implementation and focused results

- Token bucket removed completely; generic admission bypass requires live store identity. Permission continues all existing authorization checks after admission. Authentication/login/SSO/proof service implementations unchanged.
- Authentication focused selection: 16 passed, zero failures. Includes 512 same-clock ordinary reads plus 128 preference writes, signed-in early login exit, anonymous ninth-login 429, five loaded-session invalidation transitions, five stale-save transitions, fixed TTL/legacy/deleted/banned/fingerprint checks, API keys and both independent proof-limit cases.
- Mounted navigation: 4 passed, zero failures. Actual default 20-card page plus repeated navigation made 94 HTTP calls at the same store clock, all 200, with 46 capability registrations and no mounted errors. Additional repeated startup and 512-request waves passed; anonymous sliding-window admission remains eight.
- Existing Prettier formatting and scoped git diff --check pass for all six owned files. Full parent gates and GHCR release remain pending.
