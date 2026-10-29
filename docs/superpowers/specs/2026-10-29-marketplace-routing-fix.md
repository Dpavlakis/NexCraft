# Marketplace routing compatibility fix

The mod router is nested under `/api`, but its global target guard exempts metadata using unmounted `/mod/...` paths. Authenticated marketplace browsing therefore fails with `Missing mod target ID`.

Attach the existing target guard explicitly, before other middleware, to GET list/config_files and POST download/stop_transfer/toggle/delete. Remove global path classification. Preserve each route's authentication, validation, speed/concurrency controls, file-manager policy, ownership checks, and frozen nonreplaceable validated target consumed by RPC handlers.

Metadata mc_versions/search/versions/info/batch_info must work for authenticated users without instance IDs, including CurseForge, Modrinth, FTB and aggregate search sources. Anonymous metadata must be denied without provider/RPC calls. All six instance routes must reject missing/conflicting/unauthorized targets before RPC and retain the authorized target despite later request mutation.

Regression tests must dispatch through real Koa and real @koa/router nested under `/api`, including body parsing. Providers and session/ownership infrastructure may be mocked. Verify actual authentication, validation and limiter behavior where practical. Inspect unknown paths, unsupported methods, HEAD and OPTIONS: unmatched requests should retain router 404/405 behavior without target checks or RPC; Normalize HEAD to GET at the guard call so GET routes use the same query target and ownership boundary. Production body parsing excludes HEAD; reject contradictory repeated HEAD query IDs before authorization.

Only the router, mod-target tests, and this spec/companion plan may change. No commits/pushes, main changes, builds or deployment monitoring; parent handles review/builds.
