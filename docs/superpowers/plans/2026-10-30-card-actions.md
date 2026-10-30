# Execution plan — approved card actions

1. One Sol 6.1 worker updates Shortcut.vue and affected focused component tests, preserving native handlers and moving only the existing organization component. It captures actual native previews using isolated private helpers; no shared fixture/server changes.
2. Parent reviews spec compliance, responsive placement, focus/click ownership and the bounded diff; updates the private synopsis after source freeze.
3. Run affected settings/component tests and frontend type-check/production build. Repeat only for concrete changes or failures. Backend source is unchanged; mandatory CI still runs the full suites and shipping checks.
4. Stage only production, meaningful tests and these spec/plan files. Commit/push test with the truthful Codex coauthor footer. Keep AGENTS.md, audit-reports, docs/mockups and ignored previews out of git.
5. Wait for successful exact-commit validation, verify remote test still matches, dispatch test GHCR, and leave GHCR monitoring to the user. Record the checkpoint and share concise changes, preview and workflow links.

## Local verification

Completed parent review: the Shortcut script block and native action handlers are unchanged. The existing organization component moves once, preserving its props/events and target guards. Desktop List now has four body tracks and enough natural width for labeled actions.

336 settings/component cases pass; frontend type-check and production build pass after correcting a new test-helper typing assertion. Focused native checks cover 12 combinations of three layouts, desktop/mobile and dark/light, plus long names, first-line alignment, natural wrapping and keyboard focus. Existing lifecycle/test-stub/Sass/chunk warnings are recorded separately. No backend changes or live server actions were made. Exact-commit hosted validation remains the publication gate.
