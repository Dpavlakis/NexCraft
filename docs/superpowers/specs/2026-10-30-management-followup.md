# Server management follow-up — 2026-10-30

The user requests four corrections after testing the management design: replace the odd text disclosure arrow with a proper aligned chevron; remove the inline Quick Settings block and retain its existing Manage button/overlay; show truthful backup/modpack-update progress instead of premature/repeated 100%; keep server controls responsive immediately after switching layouts. Preserve the approved grouping, three layouts, seven supported overlay controls, data, permissions, confirmations and custom layouts. Main remains unchanged.

Quick Settings is overlay-first. New default terminal layout returns to Console then Basic Information beside Manage. Remove only the exact previously generated stock inline layout on upgrade, preserving IDs/titles/meta and deliberately customized arrangements; keep the standalone route and Manage entry.

The archive progress denominator currently grows during glob discovery, so processed/discovered bytes can equal 100% long before archive completion. Report real processed files/bytes and phase activity while the total is not stable; use measured percentages only for genuinely measurable stages. Never invent time-based percentages or claim 100% before archive/output close and task success. Modpack updating includes backup, stop, download, apply and bootstrap/finalization; distinguish stage progress from complete-operation success. Preserve stream shutdown, operation locks, cleanup, backup settings and world preservation.

Compatible backend progress contract: retain existing fields and add optional `phase`, `indeterminate`, `completed` to the task's `progress` object, with existing numeric `percentage`, `processedBytes`, `totalBytes`, `entries` when available. Modpack update may expose the same `progress` shape in addition to legacy `phase`/downloadProgress. Running work never reports a completed 100%; indeterminate work shows activity plus measured counts, not a guessed bar. Failed or missing tasks must not produce a success callback. Older responses without new fields remain supported conservatively. Polling must not overlap, duplicate start requests or apply late results to a different instance/unmounted card.

Investigate layout-click latency with current native components and controlled fixtures. Preserve loaded data/cache and all native actions; do not add sleeps, fetches, blocking overlays or new rate limits. Preview all visible changes with a Changed/Benefit/Status synopsis before publication. Tests should cover growing archive totals, delayed final close/failure, stage transitions, honest legacy fallback, missing/error tasks and immediate layout-switch clicks. No live backup/server mutation during automated preview.
## Additional report — update badge consistency

The user reports that ATM10's Update Modpack dialog loads current version/changelog information while Basic Information says update status unknown. Trace shared version selection/cache against the dialog. Correct proven inconsistencies using source/project/release identity and authoritative metadata; retain unknown for genuinely incomplete or ambiguous data, never infer ordering from pack filenames or force a green badge. Keep stored legacy loader data unchanged unless an explicit migration is separately justified. Do not invalidate unrelated projects or let one consumer cancel another's shared request.

## Additional design request — status visibility options

The user asks for mockups of status treatments: green for Running, amber for Starting and neutral for Stopped. Prepare three private alternatives (full outline, left status rail, corner indicator), retaining text/icons and theme/accessibility behavior. Recommend the clearest option, show the preview and synopsis, and wait for the user's choice before production implementation. This design exploration does not replace the five active bug/layout corrections or authorize deploying a guessed status treatment.

## Additional report — missing memory on Running cards

Only the Docker-instance collector fills info.memoryUsage, while normal process-tree metrics are recorded only in historical MetricSample values. Publish fresh measured process-tree memory through the existing list/detail data without per-card sampling or extra API requests. Guard against persisted history, missing/failed measurements, stopped/restarted processes and late old-PID results. Preserve genuine measured zero and Docker fallback. Show usage alone where no real per-instance limit exists; do not invent host-RAM or heap limits.

## Additional design request — visible power actions

The user requests mockups with Restart and Terminate visible beside Stop rather than inside a dropdown for every instance type. Add this to the private status-style comparison, including responsive behavior and distinct Terminate treatment. Keep confirmations and permissions intact. This is preview-only pending the user's choice, separately from the six functional/layout corrections.

## Design approval — status and actions

The user selected B (left status rail) and then approved the compact icon row. Implement the 4px status rail on server cards across all three list layouts: Running green, Starting amber, Stopped/other neutral, retaining status text/icons. Show applicable native power actions directly as icon buttons with accessible names/tooltips: preserve Console, Start/Stop, Restart, Terminate and configured Update where allowed. Keep Tag/Delete, existing confirmations, target ownership, permissions, batch behavior and click responsiveness. No new button capability or automatic operation is authorized. This supersedes the earlier preview-only gate for these two approved choices.
