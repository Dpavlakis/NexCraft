# Ports, versions, and mode switch — implementation plan

Date: 2026-10-29. Approved design: ../specs/2026-10-29-ports-versions-and-mode-switch-design.md.
Status: approved for execution.
All shell commands use explicit workdir D:\Projects\NexCraft, full PowerShell executable path, and login=false.
Writes outside the current writable roots require require_escalated with a specific reason.

## Execution and contracts
Execute on test under AGENTS.md's subagent workflow: fresh workers and spec-compliance/code-quality reviews.
Before dispatch, freeze endpoint, optional install-port, installed-version, and update-state contracts from existing APIs.
Coordinator assigns exact file ownership; shared edits are submitted as contract requests, never concurrent file changes.
C owns all shared frontend/API types and common/global.d.ts; A owns backend install request validation/wiring.
Each worker supplies i18n key/text requirements in its handoff; none edits languages/en_US.json during parallel work.
Use test for integration; test-only GHCR publication is authorized after validation. Do not create a monitor.

## Worker A — ports full stack
Own daemon/src/service/mc_port.ts, a separate read-only configured-port resolver, install/reset integration, and port tests.
Own backend install request handling and the port field in market/ModpackBrowser.vue plus services/apis/modpack.ts.
Trace modpack_install_task.ts, reset/reinstall callers, and any surviving quick_install.ts path before changing allocation.
Implement strict requested-port validation, automatic allocation, configured-instance scans, OS probes, and atomic reservations.
Check Java game/query/RCON protocol requirements and both adjacent Bedrock UDP ports; no occupied fallback on exhaustion.
Persist properties before first start; preserve reset ports and RCON credentials, including failure/rollback handling.
Wire the resolver into daemon overview/detail payloads, ping commands, and wake_listener_service.ts without periodic provider calls.
Do not edit frontend shared types, existing instance cards, node settings, version components, header, or en_US.json.
Test boundaries, malformed values, stopped/OS conflicts, concurrent installs, exhaustion, missing properties, and reset preservation.

## Worker B — installed versions and update hook/component
Own a new version/update hook and reusable component plus focused tests; no edits to existing cards, shared types, or en_US.json.
Read existing ModpackUpdate.vue and provider API contracts; request any necessary shared-contract changes through C.
Implement separate pack/Minecraft/BDS labels, explicit Unknown, supported-source checks, TTL cache, and in-flight deduplication.
Expose badge action that C can wire into the existing update panel with release notes; retain permission handling.
Test stale/error/unsupported states, FTB honesty, source/channel matching, TTL expiry, and concurrent consumers.

## Worker C — endpoint, node gameHost, cards, and shared types
Own node persistence/settings/API plumbing for gameHost, existing Instances cards/table/InstanceLine.vue, and instance/BaseInfo.vue.
Own shared frontend/API types and common/global.d.ts; integrate agreed A/B contracts and B's component into owned surfaces.
Validate hostname/IP input server-side and client-side; format IPv6 safely; keep daemon RPC configuration distinct.
Display/copy resolved configured game addresses and integrate installed versions/update badge navigation on existing surfaces.
Coordinate with A through the frozen resolver response, without editing A's daemon port/install/ping/wake files.
Test node save/load, blank fallback, invalid hosts, IPv4/IPv6, missing ports, copy behavior, and update-panel navigation.

## Worker D — header mode switch
Own AppHeader.vue and a new isolated switch component/styles/tests; consume the existing store without replacing its persistence.
Implement desktop/mobile placement, opposite-resolved-mode toggle, explicit System option, keyboard/focus, and reduced motion.
Do not edit A/B/C files or en_US.json; preserve palette selection and auto OS-follow behavior.
Test persisted light/dark/auto, OS changes in auto, palette independence, keyboard semantics, and reduced motion.

## Integration, review, and validation
After A–D code integration, a fresh final i18n merge worker alone updates en_US.json and reconciles all new keys/placeholders.
Run independent spec-compliance and code-quality review; fix findings within ownership boundaries and rerun affected checks.
Run npm run test:security (58 tests reported for cbb74693; record actual result) and focused daemon/API/mounted Vue regressions.
Run npm run build --prefix daemon, npm run build --prefix panel, and npm run build --prefix frontend (includes type-check).
Preview the real mounted Vue UI at desktop and mobile widths; exercise builder, cards/table, Basic Info, node editor, and header.
Record screenshots and verify density, truncation/copy, badge/release-notes navigation, permissions, themes, and keyboard operation.
After validation, publish the authorized test-only GHCR images including cbb74693 and approved feature changes; create no monitor.
User manually tests the isolated Test stack; test-to-main promotion follows successful manual testing.
Keep broader auth/dependency audit queued and report remaining issues honestly; do not claim these checks complete that audit.
