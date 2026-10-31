# Plan — auxiliary workflow Node24 cleanup

1. Sol6.1 worker edits only the three workflow files; parent independently checks runtime/version coverage, official download availability and docs compatibility.
2. Run YAML checks and clean locked docs install/build on Node24.22.2; complete the standing frontend pre-push type check. Do not add tests that merely duplicate YAML values or rerun unrelated app suites.
3. Review the final diff for preserved triggers, permissions and artifact behavior. Commit/push test with only the three workflows and these internal notes. No GHCR request or container updates are needed. Keep the separate broken ZIP pipeline item explicit.
## Verified result

- All three auxiliary workflows and the Windows bundled runtime download target Node24.22.2. Older v3 checkout/setup-node steps are now v4 with the existing Node24 action-runtime opt-in. Triggers and packaging scripts are preserved.
- Clean npm ci and actual VitePress1.6.4 build passed under Node24.22.2 in the disposable Linux checkout; frontend pre-push type check passed. All workflow YAML files parsed successfully.
- Official Windows node.exe URL returned HTTP200. Diff/whitespace review passed. No application, Docker, dependency lock or packaging script changed; no UI or container rollout is involved.
- The legacy master-only build remains master-only. Standalone ZIP/TAR packaging remains a separate unresolved issue; this cleanup does not claim to repair or validate those releases end-to-end.