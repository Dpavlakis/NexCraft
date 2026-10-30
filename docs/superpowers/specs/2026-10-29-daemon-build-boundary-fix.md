# Daemon build boundary fix

The daemon Docker builder installs only common and daemon dependencies. The daemon imports async-mutex in mc_port.ts but does not declare it, so the root installation can hide a dependency missing from the daemon image build.

Declare async-mutex ^0.5.0 as a direct daemon runtime dependency and update the daemon lockfile without upgrading existing packages. Replace the security workflow daemon build with an isolated build outside the checkout using tracked common, daemon, languages and lib-urls.txt inputs plus only the freshly installed common and daemon node_modules. Preserve the relative mcsmanager-common link, Node 20/24 matrix, security tests and panel build.

Scope: daemon/package.json, daemon/package-lock.json and .github/workflows/security-validation.yml, plus this specification and its matching plan. No Dockerfile, runtime, root dependency or UI changes. No commit, push, deployment or GHCR monitoring.

Validate lock consistency and unchanged existing package entries, then compile the daemon once locally in isolation if safe tracked-source staging is available. CI must fail if daemon code relies on a package supplied only by checkout-root node_modules.
