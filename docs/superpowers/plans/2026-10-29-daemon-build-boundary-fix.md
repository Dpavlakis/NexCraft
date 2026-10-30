# Daemon build boundary fix plan

1. Inspect daemon Docker, TypeScript and Webpack inputs and record the specification before code edits.
2. Run npm --prefix daemon install async-mutex@^0.5.0 --package-lock-only --ignore-scripts --no-audit --no-fund; retain existing dependency versions and lock entries.
3. Replace the daemon CI build with a mktemp directory under RUNNER_TEMP, export HEAD common/daemon/languages/lib-urls.txt with git archive, copy only common/node_modules and daemon/node_modules preserving links, and build the isolated daemon. Clean the temporary directory on exit.
4. Validate package/lock consistency and review dependency diffs. Stage only tracked build source plus own dependencies for one local isolated daemon build where reliable; otherwise leave the actual isolation check to CI.
5. Report changed manifests, validation and why the CI boundary catches the original missing-dependency failure. Do not commit, push, deploy, create agents or monitor GHCR.

Validation completed: npm package-lock-only added async-mutex 0.5.0 and tslib 2.8.1 without changing any existing package entries; npm aligned stale lock version metadata with the existing manifest version 4.15.0. A clean tracked-source archive outside the checkout, overlaid only with the changed daemon manifests, passed fresh common/daemon npm ci installs and one daemon webpack build on Node 24.16.0. No ancestor node_modules existed, and the common link resolved within staging. Removing only the staged async-mutex package made TypeScript resolution of the real mc_port.ts import fail; restoring it resolved the import. Workflow YAML and Bash syntax passed validation; the Node 20/24 matrix and all other steps are unchanged. Linux CI execution remains to be run after the parent submits the change.
