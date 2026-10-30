# Security boundaries and rollback-capable restore

Date: 2026-10-29. Target: `test` in `D:\Projects\NexCraft`.
Authorization: the user approved this design with “okay begin”; execution has no additional design approval gate. This document specifies intended behavior, not a claim that implementation or verification is complete.

## Scope: audit batch S1–S6

| Item | Required boundary |
| --- | --- |
| S1 — Mod ownership | Authorize the exact target instance for every applicable mod operation. Access to another owned instance must not authorize the requested target. Enforce the boundary server-side before side effects. |
| S2 — Safe paths | Centralize containment checks in `safe_path`; validate resolved destinations and existing path components, including symlinks/junctions, before filesystem side effects. Reject escapes and unsafe link targets. |
| S3 — World names | Treat a world name as one directory component, including valid spaces and Unicode. Reject empty names, dot/dot-dot components, separators, absolute paths and traversal; apply destination containment and symlink checks as well as name validation. |
| S4 — Archive invocation | Replace shell command construction with `execFile` and discrete archive argument arrays. Paths and names remain literal arguments; preserve tool-compatible option ordering and check failures. |
| S5 — Restore | Validate and stage archive contents before modifying live data. Promote declared restore units with a recorded rollback journal and preserve recovery material on failure. |
| S6 — Shared operation lock | Use one shared per-instance file-operation lock across restore and participating conflicting file operations, including world replace/reset and modpack update. Reject overlaps immediately; acquire synchronously before the first await and release in finally. |

No dependencies, lockfiles, UI changes, deployment changes or unrelated audit fixes belong to this batch. Remaining findings S7/S8, dependency/runtime work and frontend design are deferred to separate batches. No secrets or detailed exploitation instructions belong in these documents.

## Restore units and staging

A full backup restores the backed-up top-level entries as units. A backed-up directory is replaced as a unit so stale children do not survive; top-level entries absent from the backup remain untouched. This is not an unconditional wipe of the instance directory.

A world-only archive restores the selected `worlds/<name>` subtree as its unit, not the whole `worlds` directory. Preserve sibling worlds and all unrelated instance entries. Derive the unit set from the validated archive layout and restore mode before promotion; reject ambiguous or incompatible layouts rather than widening the scope.

Validate entries and destinations, extract into a unique staging directory, and check staged content before any destructive live operation. Staging and rollback directories use unique operation names and must not collide with user data or concurrent operations. Check archive entry types and extraction results for unsafe links, path escapes and incompatible destinations. Keep promotion on a filesystem where the chosen rename operations are supported; fail before live mutation if prerequisites cannot be met.

Record each successful move so that promotion failure can reverse completed changes in reverse order. The journal accounts for both previously existing units and newly introduced units. On failure, stop promotion and attempt rollback. If a rollback step fails, stop rollback immediately, report failure, preserve the remaining journal/staging/recovery material and do not proceed to cleanup or restart as though restoration succeeded. Never delete the sole retained recovery copy. A successful rollback still reports the original restore failure. Cleanup must not obscure an earlier failure.

## Names, links and concurrency

Name validation and filesystem containment are separate checks. A valid single-component world name containing spaces or Unicode remains supported. Existing ancestors, destinations and staged entries require symlink/junction-aware inspection. Tests should cover available link types, with explicit platform skips when creating links is unavailable. These checks reduce escape risk but do not provide a perfect TOCTOU guarantee against a hostile external process changing filesystem objects between validation and use. The application lock coordinates cooperating operations only; it is not an operating-system-wide filesystem lock.

Use a stable instance identity for the shared lock. Reserve it before the first asynchronous operation, reject a second conflicting operation rather than queueing it, and retain it through validation, staging, promotion, rollback and cleanup. Always release it on all completed failure and success paths. Independent instances may proceed concurrently. Unique staging/recovery names remain necessary even with locking to avoid collisions with leftovers from earlier attempts.

## Verification and delivery boundaries

Workers add focused regression tests under `scripts/security-tests/*.test.cjs`. The support runner discovers regular matching files, sorts their paths, and invokes `process.execPath` with `['--test', ...paths]`, the repository cwd, inherited stdio and no shell. Enumeration/start failures, an empty suite, child failure and signal termination must fail clearly. Support Node 20+ on Windows and Linux without new dependencies. Existing root install/dev scripts remain intact.

The parent runs the completed tests after all workers finish, then relevant daemon/panel builds and any required integration checks. User verification is required before deployment; this batch does not authorize commit, push or deploy. Future UI batches require user visual previews before UI deployment; this batch contains no UI work. Internal specs/plans remain excluded from VitePress through the existing `superpowers/**` exclusion.
