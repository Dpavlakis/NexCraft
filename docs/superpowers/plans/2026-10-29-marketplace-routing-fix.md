# Marketplace routing fix plan

1. Read checkout instructions, router/mount, target resolver, middleware and existing tests; confirm test branch and preserve unrelated changes.
2. Replace manual stack flattening with real Koa dispatch through the production `/api` nesting and JSON body parser. Cover all metadata/source variants, authentication, validation/limiters, six instance boundaries, immutable targets, and adjacent router behavior.
3. Run the nested metadata regression against the unchanged router and record the expected failure.
4. Extract the existing target guard as typed Koa middleware and attach it explicitly to the six instance routes; preserve its execution order and target protection.
5. Run focused security tests, inspect the scoped diff/whitespace and record totals, baseline evidence, router behavior and limits. Parent reviews/builds separately; leave changes uncommitted.

## Verification

- Before the router edit, `node --test --test-name-pattern="mounted metadata" scripts/security-tests/mod-target.test.cjs`: 12 tests failed, each returning HTTP 400 `Missing mod target ID` through the real `/api` mount.
- After the fix, `node --test scripts/security-tests/mod-target.test.cjs`: 29 passed, 0 failed. Real permission, validator, speed-limit and concurrency middleware run; providers, ownership, session/user lookup and deterministic limiter storage are fixtures. Full application boot, provider networking, UI preview and builds remain outside this focused check.
- CurseForge/Modrinth/FTB search fixtures send type=modpack to match ModpackBrowser. All six instance routes retain the original guard-first order, file-manager policy, ownership enforcement and frozen nonreplaceable target. The tradeoff is that future instance routes must explicitly attach the guard.
- Unknown routes and suffix lookalikes return 404; unsupported methods return 405 with Allow; OPTIONS returns 200 with Allow and no provider/ownership/RPC effects. Metadata HEAD works. HEAD is normalized to GET at the guard call; list/config_files accept authorized query IDs, retain the immutable RPC target after input mutation, and reject missing, conflicting repeated or unowned IDs without RPC. Before normalization, the new HEAD success test failed (HTTP 400 instead of 200).
- Existing anonymous behavior is preserved: search reaches real permission middleware and returns 403; metadata routes with speedLimit first throw for absent users and are reported as 500 by protocol. Neither reaches provider/RPC. Token/AJAX denial is tested through real permission middleware.
- Scoped diff whitespace check passed. No commits, pushes, dependency changes, UI edits or builds performed; parent handles review/builds.
