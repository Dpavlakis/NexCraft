# Security boundaries and restore implementation plan

Date: 2026-10-29. Branch: `test`. Workspace: `D:\Projects\NexCraft`.
Design: `../specs/2026-10-29-security-boundaries-and-restore-design.md`.
The user's “okay begin” authorizes execution; no additional design approval gate applies. All agents use gpt6.1sol only. The parent coordinates the four implementation workers and support work, and performs spec-compliance and code-quality review. No commit, push or deploy is authorized.

## Tasks and ownership

1. **S1: exact-target mod ownership.** Implementation owner checks every relevant mod operation against its requested instance before side effects. Add tests for authorized exact targets, unauthorized targets and cross-instance authorization confusion.
2. **S2/S3: safe paths and world names.** Implementation owner centralizes containment checks, checks existing ancestors/destinations for symlink/junction escapes and validates one-component world names. Preserve spaces and Unicode. Test valid names, rejected traversal/absolute/separator cases, containment boundaries and links. Record platform link-test skips explicitly.
3. **S4: archive process arguments.** Implementation owner replaces shell archive invocation with `execFile` argument arrays, checks tool failure propagation and preserves supported archive behavior. Tests inspect executable/argument separation and literal paths containing spaces/Unicode or shell-sensitive characters without constructing an exploitation recipe.
4. **S5/S6: staged restore and shared lock.** Implementation owner validates and stages before live changes, computes restore units, records promotions, reverses completed changes on failure and stops immediately on rollback error. Share one per-instance lock with conflicting world/restore/update operations; acquire before the first await, reject overlaps and release in finally. Use unique staging/recovery names. Coordinate helper integration with the path/world owner without overlapping file ownership.
5. **Support: runner and documents only.** Own `package.json` solely to add `test:security`, new `scripts/run-security-tests.cjs`, this plan and the paired design spec. Preserve existing root install/dev scripts. No dependencies, lockfiles or other edits. The runner sorts discovered regular `*.test.cjs` files and uses `spawnSync(process.execPath, ['--test', ...paths])` with repository cwd, inherited stdio and no shell. Fail clearly on no tests or process failure.

Implementation owners retain their exact assigned files; resolve shared-file needs through the parent. No worker should edit another worker's files. Support does not run security tests while the test files are still in progress.

## Parent test gates after all workers finish

- Review S1–S6 implementation and focused regression coverage against the design before execution. Confirm no dependency/lockfile changes or unrelated UI work.
- Run `npm run test:security` from the repository root once all test files are complete. Confirm sorted explicit discovery and child failure propagation; check the empty-suite/start-error cases in an isolated fixture without moving or editing workers' tests. Verify Node 20+ Windows/Linux compatibility, recording environments actually exercised rather than claiming unrun coverage.
- For restore, cover full-backup top-level replacement with stale-child removal and preservation of absent top-level entries. Cover world-only `worlds/<name>` replacement with sibling-world preservation. Cover invalid archive rejection before mutation, staged validation failure, partial promotion failure, reverse rollback, removal of newly introduced units, rollback failure stopping immediately and recovery material retention. Confirm errors do not become apparent success or a success restart.
- For locks, cover same-instance rejection during each asynchronous phase, shared participation across conflicting operations, independent-instance concurrency, release after both success and error, and unique names when leftovers exist. Review the acquisition point for reservation before any await.
- Run `npm run build --prefix daemon` and `npm run build --prefix panel` after integration. Run additional checks only where changed code warrants them. Record failed, skipped and unrun checks, including link-creation limitations; fix failures and rerun affected checks.
- Review the final diff for scope and secrets. Confirm existing VitePress `srcExclude` still excludes `superpowers/**`; do not change site configuration for these documents.

## Delivery gate and deferred work

Report concrete changes, validation results and known limitations to the user. Parent/user verification precedes any deployment; do not commit, push, publish images or deploy as part of this task. This backend batch has no UI. Any subsequent UI work requires user visual previews before UI deployment.

S7/S8 findings, dependency/runtime changes and frontend design remain separate batches with their own scope and verification. Do not describe them as fixed by S1–S6. Symlink validation and the cooperating-process lock do not establish a perfect TOCTOU guarantee against outside filesystem mutation.
