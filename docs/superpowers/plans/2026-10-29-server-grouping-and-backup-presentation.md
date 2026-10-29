# Server grouping and backup presentation plan

1. Inspect assigned Vue views, existing provider assets, backend backup naming and current selection reliability tests.
2. Add narrow metadata grouping and provider badge helpers/components. Render two default-open groups over current page cards; force groups open for batch and retain existing selection/request guards.
3. Add backup-kind classifier and focused responsive BackupList presentation component; forward original entries into existing action handlers without changing task/API logic.
4. Save unique English keys in ignored preview fragment. Add focused tests for metadata, collapsed groups/batch visibility, page/node ownership and exact backup action payloads.
5. Run only scoped tests, inspect scoped diffs and report readiness to parent for the owned 4181 preview and integrated build. Do not start preview servers, deploy, commit or push.

## Execution record

Completed the four assigned views and added narrow ServerGroup, ServerSourceBadge and BackupList components plus metadata/presentation helpers. All changes are direct edits in D:/Projects/NexCraft on test. No worktrees, branches, commits, package changes or publication.

Focused runner: from frontend, `node node_modules/vitest/vitest.mjs run --config src/settings-tests/group-backup.config.ts`.

Coverage includes the original InstanceList selection-owner suite, source classification/order/identity, provider assets, collapsing then entering batch mode, preventing hidden selected cards, per-node derived grouping and original load-more placement, synthetic-row safety, ten-entry backup pagination, unknown archives, exact event payload identity, confirmation gating and restore disabling. The fixture harness follows the existing reliability test's API and visual stubs; production APIs are not contacted.

First run exposed test-harness assumptions (Vite SVG inlining and Vue reactive proxy identity); assertions now compare imported assets and unwrapped original records. Running from the actual frontend directory resolves the file-root loader issue. The next focused run passed 57 tests across three files; final explicit screenshot-name and unusual-metadata coverage is recorded in the handoff after the final run.

`git diff --check` passed. Final integrated type/build and 1440px/390px light/dark preview QA remain with the parent/preview worker as assigned. Components and six-key English fragment are ready for Meitner's fixture hooks at port 4181; port 4180 was not touched.

Final focused result: 61/61 tests passed across three files (including the existing InstanceList selection suite), 2026-10-29. Added explicit legacy screenshot filenames and unknown/prototype-like metadata regression cases. All assigned components are wired; parent can proceed with the coordinated preview and catalog merge.
