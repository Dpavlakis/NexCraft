# Instance card feedback fix plan

1. Restyle existing version statuses as compact pills, preserving permissions, latest-release tooltip and candidate query.
2. Remove duplicate address hints in Shortcut, Basic Info and InstanceLine. Gate fallback guidance on a usable node-derived address; preserve source/restart tooltip and configured port.
3. Compile all four Vue SFCs and run focused existing version/address regressions. Inspect the scoped diff and report readiness for parent review and mounted Vue preview.

No agents, endpoint-helper changes, commits, pushes or publication in this follow-up.

Validation complete: four SFC scripts/templates/styles compile; frontend type checking passes; 44 existing version/address regressions pass; 15 rendered address-state checks pass without Vue warnings. Absent endpoint metadata alone shows the daemon-update message. Configured-port row and source/restart details are preserved. Mounted full-card light/dark, dense-grid, narrow-width and keyboard preview remains with the parent before publication.
