# Java selection correctness fix — 2026-10-29

## Contracts
- Replace only a recognized Java launcher token with `{mcsm_java}`; preserve every remaining startup-command character, including quoting and spacing. Reject script launchers with guidance to configure Java in the script or use a direct Java command; never rewrite the script.
- Selection and launch require a known, ready runtime whose executable is a regular file and accessible (execute permission on POSIX, read access on Windows). Preserve installed paths with spaces and existing platform resolution.
- Serialize selection and deletion. Reject deletion for any saved instance reference, live instance reference, or launch reservation/running runtime, including A running while B is selected. Release usage on exit/failure using launch identity, independent of pending configuration.
- Persist the complete candidate config before publishing Java ID and launcher together. Stage through synchronous storage and rename into place, so definite write/partial staged-write/rename failures preserve prior memory/disk. Confirm the exact candidate by readback if rename acknowledgement fails; unreadable ambiguous outcomes and crash durability are not claimed safe. Keep persistence changes local to Java selection.
- Preserve auto-provisioning, explicit-choice bootstrap behavior, and one-retry stop guards. Handle executable disappearance at spawn narrowly.

## Scope and verification
Only daemon Java manager/router, command resolution and narrowly coupled instance Java persistence/lifecycle, the existing Java selection test, this spec/plan and verification report. No presentation, panel permissions, API/auth changes, dependencies, branches, worktrees, commits, pushes or deployment. The repository requirement for Sol6.1 subagent implementation remains in force. This assigned worker must not create nested workers; that no-recursion boundary is not a user override of the parent workflow. Preview remains required before rollout.

Convert defect characterizations to positive regressions; demonstrate they fail before implementation. Cover quoting, invalid/missing/inaccessible runtimes, scripts, saved/running deletion, selection/deletion interleavings, cleanup, definite persistence failures and normal controls. Run only the focused file and necessary focused type checks. Execute existing local Java only with `-version`; no downloads or Minecraft. Report exact evidence and limitations, including ambiguous disk acknowledgements.
