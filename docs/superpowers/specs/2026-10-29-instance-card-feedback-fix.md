# Instance card feedback fix

The mounted cards repeat the unavailable configured-address message and show a node verification hint even without a usable address. Update availability reads as an underlined link instead of a notification pill.

Keep changes within InstanceVersionInfo.vue, Shortcut.vue, BaseInfo.vue and InstanceLine.vue, plus the English presentation label. Use a rounded, themed status capsule with a visible indicator, readable text and keyboard focus. Available updates remain an admin-only button; other users receive a non-interactive pill. Preserve exact candidate navigation and unknown-status semantics.

Render one unavailable-address message. Show node guidance only for a valid fallback address; preserve source/restart detail in tooltips or Basic Info and keep the configured-port row. Retain compact responsive layout. Endpoint resolution and server investigation belong to the parent task.

Validate Vue SFC compilation and focused existing regressions. Parent reviews the actual mounted Vue preview before any publication. Do not commit, push or publish.

Parent confirmed the daemon image failed to build because of an undeclared dependency; endpoint resolution remains unchanged. Only responses missing gameEndpoint entirely show the concise daemon-update message in place of the unknown-address reason. Explicit unavailable endpoint metadata retains its original reason.
