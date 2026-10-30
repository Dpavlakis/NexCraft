# Implementation plan: configuration interactions and Java presentation

1. Read root CLAUDE/AGENTS, assigned Vue/API contracts, Java audit, and existing test conventions.
2. Add semantic file-row activation and opt-in accessible boolean switches without coercing text/numeric/magic values.
3. Add one narrow properties-save confirmation helper, capture last successful snapshots, and gate structured/raw keyboard saves with a synchronous busy guard.
4. Remove only Basic Info configured source hint, retaining endpoint fallback help.
5. Clarify Java installation/selection/running usage and next-start copy; require true acknowledgement, preserve backend errors, and serialize Add/Download/Delete/Select actions.
6. Append English strings in existing format. Add focused component/interaction tests using installed tooling; no package changes or full build.
7. Report exact files/checks and visual handoff to parent; merge other workers' string fragments only when notified.

Constraints: direct assigned-source edits, no agents/worktrees/branches/commit/push/GHCR, no preview ownership changes, preserve private instructions and unrelated work.

## Completed checks and parent handoff

- Implemented the seven assigned Vue sources plus narrow `frontend/src/tools/confirmServerPropertiesSave.ts`; no API/backend/package/Quick Settings edits.
- `InstanceConfigEditor` recomputes flattened bindings after a replacement config object; `LineOption` watches the incoming object/key. Focused refresh regression edits only the new object. Numeric preservation is confined to the opt-in editor; legacy boolean/raw/numeric behavior has a control test.
- Raw confirmation captures text, target, daemon, instance and dialog generation before awaiting. Replacement/open/close/unmount invalidate old continuations. Stale loads and admitted saves cannot update/close the replacement dialog. Structured saves reject changed card/target or unmount before writing or publishing feedback.
- Merged all 2 Java backend and 6 grouping/backup English fragment keys, preserving the existing catalog layout. Own additions: 13 keys.
- Initial focused Vitest run before the authoritative-snapshot follow-up: **28/28 passing**, installed Windows Node 24.16.0 / Vitest 4.1.12; no build or full suite. Command from `D:\Projects\NexCraft\frontend`: `node node_modules/vitest/vitest.mjs run --config src/components/__tests__/account-security.config.ts src/components/__tests__/ConfigInteractions.test.ts`.
- Coverage includes payload types, native whole-row button/focus/click semantics, actual replaced-object Refresh, properties-only confirmation/cancel/pristine saves, raw button and Ctrl+S paths, stale confirmation/load/save continuations, Java false/error/true acknowledgements, running A versus selected B, duplicate-action guards, downloading status, Add failure/retry, Download acknowledgement and actual Delete confirmation/rejection.
- Browser Enter/Space default activation, responsive wrapping and visual appearance remain parent-owned QA on 4181. No claim of browser visual verification from jsdom.
- Scoped whitespace check passed. Parent owns the single integrated build and final visual QA.
- The initially reported legacy Java status-test boundary is resolved below under the parent-released test integration.

## Authoritative Java snapshot follow-up

1. Add a force-read of getInstanceInfo after acknowledged Java selection and merge only saved Java ID/startCommand into the original snapshot, guarded against replaced/unmounted context and concurrent startup-command edits.
2. Keep acknowledgement success distinct from subsequent refresh failure; retain the accepted ID and show persistent refresh guidance with the existing Refresh control as a read-only retry.
3. Extend mounted tests for running selection, rejection, refresh failure/recovery and unrelated local-field preservation.
4. Update only the released Java verification test UI collaborator for getInstanceInfo and replace old status callback assertions with direct stopped/running/exited usage assertions. Parent runs the combined backend verification.


## Authoritative snapshot result

- True acknowledgements retain the accepted Java ID immediately, force-read getInstanceInfo using captured daemon/instance IDs, and merge only saved config.java.id/startCommand into the existing config object. Other fields and running-process data remain intact. Concurrent startup-command edits and replaced/unmounted snapshots are guarded.
- Failed authoritative/catalog reads produce persistent saved-but-refresh-needed guidance, retain accepted state, and retry through the existing Refresh control without repeating the selection write. False/rejected writes do not request the snapshot.
- Final focused mounted UI result: **33/33 passed** on Windows, covering the new successful-running/rejected/refresh-failure/retry/local-edit cases. No full build or backend suite was run.
- Authorized verification-test-only integration: getInstanceInfo collaborator returns the persisted real configuration and asserts forceRequest/query values; persistence control now compares the local launcher with that persisted launcher. Removed only old Stopped/In Use presentation expectations and retained direct empty/start UUID/exit empty runtime-usage assertions. Existing persistence/launch/concurrency guards remain intact. Backend verification file passes node --check; parent owns the combined backend run.
- Added one English refresh-guidance key; both prior fragment merges remain exact.
