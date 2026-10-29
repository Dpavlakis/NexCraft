# Implementation plan: drop feedback and update release notes

1. FileManager.vue: replace opacity toggling with file-only drag state and a non-intercepting overlay; retain upload confirmation; clean up drag lifecycle listeners.
2. Panel mod manager service + router: add GET /protected_modpack/changelog returning {content, format}; validate identifiers, fetch provider-specific notes, check Modrinth project ownership, preserve upstream failures.
3. Frontend modpack API + ModpackUpdate.vue + en_US.json: add typed API, selection watcher with stale-request protection, sanitized notes, loading/empty/retry states, constrained layout, and translation keys for both changes.
4. Update user docs; review all diffs and integration contracts; run relevant checks; commit only intended files to test and publish GHCR test without watching the build.

Execution: GPT-6.1 Sol subagents only, disjoint file ownership, then independent review.
