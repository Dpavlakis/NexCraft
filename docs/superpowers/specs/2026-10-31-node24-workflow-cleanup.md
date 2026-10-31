# Auxiliary workflow Node24 cleanup — 2026-10-31

Production Web/Daemon images and the security/shipping validation already use Node24.22.2. The user requested cleanup of the remaining older versions in auxiliary workflows after clarification that this is configuration maintenance.

Align docs.yml, release.yml and webpack.yml to the same exact Node24.22.2. Align the Windows node.exe included by release.yml to that version. Ensure JavaScript actions in these workflows use the established Node24 runtime opt-in, and update legacy checkout/setup-node v3 steps to the repository's v4 baseline. Preserve existing triggers, artifact names, permissions and packaging scripts. Do not reactivate the master-only legacy workflow on main/test, modify application/Docker runtimes or repair the already-broken standalone packaging flow.

Verify YAML syntax, the official Windows download target and a clean locked docs install/build on Node24. No user-interface preview or Docker rebuild is required for workflow-only maintenance. Existing docs dependency locking may be used if verified. Commit/push test after review; main promotion is separate unless the user authorizes it.