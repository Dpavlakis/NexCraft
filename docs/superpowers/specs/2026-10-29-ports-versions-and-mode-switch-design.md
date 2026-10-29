# Ports, versions, and mode switch — approved design

Date: 2026-10-29. Status: approved for execution; all preview items approved.
Repository: D:\Projects\NexCraft.
AGENTS.md was read; the user's actual path and explicit release restrictions override stale path/push instructions there.

## Scope and experience
Extend the actual new-instance builder in frontend/src/widgets/market/ModpackBrowser.vue.
Keep the existing dense Vue 3 / Ant Design Vue layout; no replacement mock page or broad redesign.
Include optional ports, configured addresses, honest installed versions/update status, and a header day/night switch.
Import and reset do not gain a new-port picker; resets preserve existing network settings and RCON credentials.

## Ports and configured endpoints
The new-instance builder accepts an optional port; blank means automatic allocation.
Validate strictly on both frontend and daemon: decimal integer Java 1..65535; Bedrock 1..65534.
Reject fractional, exponent, partial, malformed, zero, and out-of-range values; explicit conflicts never silently fall back.
Bedrock reserves adjacent UDP ports p and p+1 for server-port and server-portv6, checking both endpoints/families as applicable.
Java game TCP and query UDP may share the game number; RCON TCP must be distinct; check every enabled endpoint.
Reject collisions with all configured instances on that daemon, including stopped instances, OS listeners, and pending installs.
Use daemon-scoped atomic allocation/reservations across validation, allocation, and property persistence; release on failure/cancel.
Automatic allocation remains bounded, respects the range, and fails clearly on exhaustion instead of returning an occupied default.
Write server.properties and matching persisted ping/RCON configuration before first start, including when the file does not exist.
Reset/reinstall snapshots and restores existing game/query/Bedrock ports, RCON port, enablement, and password rather than reallocating.
A shared read-only resolver reads actual server.properties; never allocates, repairs, rewrites, or exposes RCON secrets while reading.
Use the resolved configured port consistently in overview, detail, ping, and wake; missing/invalid properties yield honest unavailable state.
Cache local parsed properties with invalidation on file/config changes; no provider requests or new external/network work per 3-second refresh.
Existing player ping remains intentional; it uses the resolved local server endpoint, not the player-facing host.

## Node game host and address UI
Add optional persisted node gameHost, separate from daemon RPC host/port, editable through existing node settings.
Accept a hostname, IPv4, or IPv6 literal; reject schemes, paths, credentials, whitespace, and embedded ports.
Normalize IPv6 and format copied/displayed addresses as [IPv6]:port; hostname/IPv4 use host:port.
When absent, derive host from the existing node host; never substitute the daemon RPC port for the configured game port.
Expose only authorized configured endpoint data through panel/daemon APIs, with no DNS/provider lookup needed for display.
Show and copy game address on Instances cards, table rows, and instance/BaseInfo.vue (Basic Info); handle missing ports explicitly.

## Installed versions and update status
Keep installed pack version separate from Minecraft version; Bedrock displays installed BDS version explicitly.
Use persisted installed metadata, not newest provider release or a guessed runtime version; missing provenance displays Unknown.
Share update checks by provider/project with a 10-minute TTL and in-flight promise deduplication; filter for relevant edition/channel.
Check only CurseForge, Modrinth, and Bedrock in the current supported update flow; FTB is unsupported, never falsely Up to date.
Distinguish checking, update available, up to date, unknown, unsupported, and failed checks; errors never imply current.
An update badge opens the existing ModpackUpdate panel and release notes with instance context and existing admin permissions.
Reuse the installed/update services and current supported behavior; do not invent an FTB updater or new installation source.

## Header appearance control
Place a compact iOS-style day/night switch near profile controls in desktop and mobile AppHeader.vue.
Reuse useAppConfigStore's persisted auto/light/dark mode and resolved appearance; preserve the independent theme palette.
A toggle selects the opposite resolved explicit mode; retain an accessible System-follow option to restore auto.
Provide keyboard activation, focus visibility, accessible switch name/checked state, touch target, and reduced-motion behavior.

## Delivery gates and exclusions
Execution uses four disjoint implementation workers, a final i18n merge worker, and independent spec/code review.
Require meaningful regression tests, local builds, and mounted Vue desktop/mobile previews before a test release.
First security batch cbb74693 is already local (reported 58 tests), unpushed; include it in the eventual test GHCR publication.
Broader authentication/dependency audit remains queued; this feature does not claim that audit is fixed.
Test-only GHCR publication is authorized after validation, without a monitor; main promotion follows successful manual Test-stack testing.
