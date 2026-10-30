# Java selection verification � 2026-10-29

## Current result

The bounded daemon fix addresses the six audited defects. Direct Java selection preserves argument source text and saves the selected executable for the next launch. A running process keeps its launched Java while a newly selected runtime remains pending. Script selection is rejected without rewriting the script or changing its saved Java fields.

**Author verification before independent review: 28/28 passed on Windows Node 24.16.0 and Linux/WSL Node 24.22.2, with zero failures or skips.** Six touched daemon files had zero focused TypeScript syntax/semantic diagnostics. Independent review added seven tests and two bounded source fixes; its affected subset passed 8/8, followed by one additional final-metadata failure check passing 1/1, on both platforms. Both newly edited source files had zero focused diagnostics. The parent owns the final combined run. No build or full suite was run. These are backend correctness checks; parent-owned presentation/live preview and rollout remain outstanding.

## Scope and boundaries

- Actual shared checkout: `D:\Projects\NexCraft`, branch `test`. Read root CLAUDE.md and AGENTS.md. The repository requirement for Sol6.1 subagent implementation remains in force. The assigned worker has a no-recursion boundary and creates no nested workers; this does not override the parent workflow. No branch/worktree operations, commits, pushes, deployment or package changes were performed.
- Product changes: Java manager, daemon Java router, Java launcher replacement helper, GeneralStart spawn-error handling, PTY managed-runtime reservation and helper spawn-error handling, and narrowly coupled instance Java save/resolution/resource cleanup/automatic correction. Global `Instance.parameters()` semantics remain untouched.
- Tests/spec/plan/report are the other owned files. Other workers' frontend presentation, frontend apiService, panel session/permission, and authentication tests were not edited. No preview server or user data was accessed.
- New message strings are staged only in ignored `frontend/node_modules/.cache/nexcraft-preview/java-fix-strings.json`. Another worker must merge these into the language resources before preview/rollout; until then the new keys are not localized. `languages/en_US.json` was not edited.

## Fixed contracts and evidence

| Contract | Implementation and regression evidence |
| --- | --- |
| Preserve quoted argv | `replaceJavaLauncher()` replaces just the original launcher span. Re-selection preserves all trailing spaces/quotes. Launch captures prove a spaced jar path and spaced JVM argument stay single argv values. Path syntax controls cover Windows, POSIX, relative Java and existing placeholders. Literal `$&` in an installation home also survives resolution. |
| Reject invalid selections and launches | Shared resolver rejects unknown/downloading entries and executables that are absent, directories or inaccessible. `stat().isFile()` follows valid symlinks; access uses Windows R_OK / POSIX X_OK. Selection rejection preserves previous memory/disk. Launch repeats validation; Linux chmod control confirms execute permission is required. |
| Preserve script launchers | Selection of `bash startserver.sh` fails with guidance to configure Java within the script or use a direct Java startup command. Script/config/disk stay intact. A legacy script config with a stale Java ID does not report that Java as its launched runtime. |
| Protect referenced runtimes | Deletion checks launch reservations, loaded instance configuration, and every saved InstanceConfig JSON, including an unloaded saved instance. Both running A and pending B are protected. An unreferenced runtime deletes normally; an external registered installation home is preserved. |
| Serialize selection/deletion/launch resolution | One existing-dependency async-mutex serializes validation+selection publication, deletion reference scan+filesystem removal, and executable resolution+launch reservation. Gates exercise selection-first and deletion-first interleavings; neither leaves a dangling saved ID. |
| Track launched identity | General and PTY start resolution reserve the resolved runtime before the awaits preceding spawn/open. Selection of B during A's launch cannot relabel A. Stop/resource release/failure remove the UUID from actual usage lists independently of current configuration. Tests cover normal exit and startup failure with B pending. |
| Keep failed saves consistent | A Java-only candidate is synchronously serialized through real storage into `data/JavaSelection`, then renamed over the saved InstanceConfig before publishing its Java ID and command. Definite write failure, partial staged write, and definite rename failure retain prior memory/launcher/disk. Temporary files are cleaned up. The global parameters path is not rewritten. |
| Catch spawn-time disappearance | GeneralStart installs `spawn`/`error` listeners before inspecting the PID. A controlled asynchronous ENOENT after successful validation goes through the real AbsStart failure path, leaves STOP/unlocked/no process, and releases A even while B is pending. No unrelated process adapter rewrite. |
| Preserve provisioning/recovery | Existing controls still prove explicit-choice bootstrap behavior, reuse of matching installed Java, matching system-Java fallback, controlled install-failure cleanup, startup mismatch correction and one-retry stop guard. Automatic correction uses the same validated candidate-save path; a failed save preserves the original choice and requests no retry. |

## Persistence semantics and exact limits

`common/src/system_storage.ts` uses synchronous `writeFileSync`; it is not an async API and its ordinary store directly truncates the destination. The Java fix stages a complete candidate separately so partial write failure cannot truncate the current config. Both staging and rename run synchronously; configuration publication follows the successful rename without an intervening await.

A simulated rename that actually succeeds and then throws is reported as success **only after exact serialized candidate readback**; this case is tested. A definite rename failure is rejected and leaves the original file/config intact; also tested. If an acknowledgement fails and the destination cannot be read, the operation reports the original storage error without publishing the candidate. That unreadable/ambiguous outcome is **not proven memory/disk-consistent**, and no safety claim is made for it. Crash/power-loss durability, fsync guarantees, network-filesystem rename semantics, ownership/ACL preservation and external writers are outside these checks. The mutex coordinates this daemon's Java selection/deletion/resolution paths; unrelated settings writers or other processes do not participate in it.

Deletion scans unreadable/malformed saved configs conservatively and fails rather than assuming there is no reference. This may require repairing a broken saved config before a runtime can be removed.

## Reproduction and checks

Windows, full PowerShell executable, `login:false`, working directory `D:\Projects\NexCraft`:

```powershell
& 'C:\Program Files\nodejs\node.exe' --test scripts/security-tests/java-selection.test.cjs
```

Linux, same checkout through the existing WSL runtime:

```powershell
wsl.exe --exec /bin/sh -lc 'cd /mnt/d/Projects/NexCraft && /home/dimit/nexcraft-runtime.K43JZB/toolchain/bin/node --test scripts/security-tests/java-selection.test.cjs'
```

Before implementation, converting the existing defect assertions to positive regressions produced **7 passing / 8 failing** tests on Windows. Failures exposed quoting loss, script acceptance, stale usage, pending/selected deletion, invalid selection, missing executable acceptance, and memory changing after failed persistence. The author-verified file had 28 positive checks including concurrency and normal controls; independent review added seven focused checks, for 35 total before the parent combined run; there are no passing BUG characterizations remaining.

Focused TypeScript check used installed daemon TypeScript 5.9.3 and daemon tsconfig options, six touched source files plus ambient declarations as roots, imported dependency resolution, and `getSyntacticDiagnostics`/`getSemanticDiagnostics` for only those six files, with `noEmit:true`. Result: **0 diagnostics**. This is not a full-project typecheck. Scoped `git diff --check` also passes. No full suite, frontend build or daemon/panel build was run.

## Real installed Java checks

Only the following pre-existing executables ran, with exactly `-version`, disposable working directories and exit code 0:

| Executable | First output line |
| --- | --- |
| `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot\bin\java.exe` | `openjdk version "21.0.12" 2026-07-21 LTS` |
| `C:\Program Files\Java\jdk-21.0.10\bin\java.exe` | `java version "21.0.10" 2026-01-20 LTS` |
| `/usr/lib/jvm/java-21-openjdk-amd64/bin/java` | `openjdk version "21.0.11" 2026-04-21` |

These demonstrate executable switching across installed paths/builds; all report major 21. No actual Java 17/25 execution or Minecraft/loader compatibility is claimed. Synthetic metadata uses those major versions elsewhere. No downloads or Minecraft launch occurred.

## Harness and preview limitations

Tests transpile complete source modules with explicit dependency maps, real disposable JSON store/load, real instance/manager/router/parser/start/provision/retry code, and real async-mutex. Transport/auth middleware, Vue macros/reactivity/toasts, instance-manager forwarding, timers and most process boundaries are controlled. The startup ENOENT is controlled, not a real failed JVM spawn. The failure regression uses real AbsStart cleanup with its anti-loop sleep suppressed and kill controlled.

No browser mount, live panel/daemon authentication, actual restart, PTY helper execution, macOS execution or installer ran. PTY resolution and controlled helper ENOENT now have focused regressions; the actual PTY executable and its target-process protocol were not executed. The row/action presentation remains another worker's scope. Preview is required before any rollout, after the message fragment and presentation changes are merged.


## Independent focused review follow-up

The review read the root guidance, spec, plan, author verification and scoped diff in the actual shared checkout. It confirmed that the existing commandStringToArray implementation is unchanged from HEAD; only a separate Java launcher-span helper was added. Non-Java GeneralStart controls preserve Windows paths with spaces/backslashes, trailing backslashes, embedded quoted option values and legacy {quotes} nested-quote tokens, including a stale unused Java ID.

Two concrete gaps were reproduced before their source fixes:

- PTY checked the helper PID without an error listener. A helper disappearing after its existence check could emit an unhandled ENOENT. The regression failed before the fix; PTY now awaits spawn/error before checking the PID and routes ENOENT through AbsStart failure cleanup. A separate control rejects a missing Java executable before the helper is spawned. These are controlled process boundaries, not actual PTY execution.
- Public deletion accepted a catalog entry while its installer was pending. The regression failed with a missing expected rejection. Deletion now rejects downloading entries using the existing message key. The installer's own failed partial-directory cleanup runs under the mutex, verifies the same still-pending JavaInfo identity, and bypasses the public saved-config scan. This preserves cleanup even when an unrelated saved config is malformed. A further regression covers final metadata-save failure after the ready flag was cleared: the catch path marks the attempt unavailable again before cleanup. Download I/O was controlled; no download was performed.

Additional controls prove that malformed JavaSelection staging files do not enter the InstanceConfig saved-reference scan, malformed saved configs still block public deletion, and a parser exception releases reserved A after B is selected without spawning. The existing GeneralStart asynchronous ENOENT and failed-install cleanup controls were included because the new fixes touch those boundaries.

Exact Windows check, from D:\Projects\NexCraft:

~~~powershell
& 'C:\Program Files\nodejs\node.exe' --test --test-name-pattern='PTY|non-Java GeneralStart|active installation|saved-reference scanning|parse failure releases|real download/install failure|spawn ENOENT' scripts/security-tests/java-selection.test.cjs
~~~

Exact Linux check through the existing WSL runtime:

~~~powershell
wsl.exe --exec /bin/sh -lc 'cd /mnt/d/Projects/NexCraft && /home/dimit/nexcraft-runtime.K43JZB/toolchain/bin/node --test --test-name-pattern="PTY|non-Java GeneralStart|active installation|saved-reference scanning|parse failure releases|real download/install failure|spawn ENOENT" scripts/security-tests/java-selection.test.cjs'
~~~

Both checks: 8 passed, 0 failed, 0 skipped. After the final metadata-failure control was added, it was run separately on each platform with the same commands above and --test-name-pattern='failed final install metadata': 1 passed, 0 failed, 0 skipped on each. The eight previously passing checks were not repeated. TypeScript 5.9.3, daemon tsconfig options, no emit, edited PTY start and Java manager source files plus configured ambient roots: 0 syntactic/semantic diagnostics in those two files. The Java manager check was refreshed after the final failure-state correction: 0 focused diagnostics. Scoped git diff --check passed. No full suite/build or complete 35-test rerun was performed by this reviewer; the parent integrates the final run. No existing Java executable needed to run for these eight checks.

Review edits: daemon/src/entity/commands/pty/pty_start.ts, daemon/src/service/java_manager.ts, scripts/security-tests/java-selection.test.cjs, this report, and the spec workflow wording. The spec/report now distinguish the worker no-recursion boundary from the continuing repository requirement for Sol6.1 subagent implementation; they claim no user override. No frontend/message-fragment, package or Git mutations occurred. The persistence acknowledgement/crash-durability limitations above remain unchanged.
