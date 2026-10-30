# Java selection fix plan — 2026-10-29

1. Read guidance, verification, tests and actual storage/process semantics. Write canonical spec and this plan before implementation.
2. Replace BUG characterizations with positive regressions; add deterministic concurrency/normal controls and spawn error tests. Run against baseline and record expected failures.
3. Implement a manager serialization boundary for selection/deletion, shared executable validation, saved/live reference protection and launch-identity usage cleanup. Replace only the launcher source span.
4. Add Java-specific candidate-before-publish persistence using local atomic file replacement if needed to avoid truncating the saved config; verify readback for an ambiguous rename acknowledgement rather than claiming unverified safety. Do not rewrite global parameters().
5. Narrowly handle spawn-time disappearance and preserve provision/retry behavior. Run focused tests (existing Java -version only) and focused diagnostics if needed; review the bounded diff and update the verification report with exact results and limits. No rollout; parent-owned preview gate remains.

## Execution evidence
- [x] Guidance/storage/process semantics read; spec and plan written first.
- [x] Baseline positive regressions: 7 pass / 8 expected failures before product edits.
- [x] Scoped manager/router/resolution, staged selection persistence, launch usage and spawn-error fixes implemented.
- [x] Final focused Windows and Linux runs: 28/28 each, no skips. Existing Java -version only; no downloads/Minecraft.
- [x] Six touched daemon files: zero focused TypeScript diagnostics, no emit/build. Scoped diff whitespace check clean.
- [x] Verification report updated with acknowledged limitations and parent-owned preview/message-merge gate. No rollout or Git mutations.
