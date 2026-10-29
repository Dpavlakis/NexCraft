# Server grouping and backup presentation

Scope: reversible presentation in InstanceList, Shortcut, InstanceLine and Backups; no Quick Settings backend or package changes. Parent owns coordinated preview at port 4181 and rollout approval.

Use actual config.packInfo.source: curseforge/modrinth/ftb are Modpack Servers; vanilla/serverjar/bedrock/missing or unrecognized metadata are Custom Servers. Both groups start open, show loaded page counts and preserve node, filters, pagination, refresh guards and selection snapshots. Batch mode forces every selectable card visible. Native group buttons expose aria-expanded and keyboard focus. Provider badges use existing assets. Global table grouping, if added, derives from the raw tree and keeps node/load-more rows safe.

Backups use unchanged API entries {name,size,time}. Recognize only backend-generated world-/backup- timestamp names (including real suffixes and directory forms); unknown names remain Unknown. Lead with kind, time and size; filename is secondary. Keep download/delete/restore actions visible at half-width and 390px. Preserve paths, permissions, confirmation and exclusion behavior.

New English strings use TXT_CODE_server_groups_* / TXT_CODE_backup_kind_* in the ignored group-backup-strings.json fragment. No languages/en_US.json edits. Focused metadata, batch/page ownership and backup action interaction checks; parent performs one integrated build and visual QA.

## Implemented contracts

- `InstanceList.vue` projects two source-based groups over `instancesMoreInfo`. The loaded-page validity and query/generation checks, snapshot submission, selection clearing and background refresh guards remain operationally unchanged.
- `ServerGroup.vue` supplies native disclosure buttons with focus-visible styling and `aria-expanded`. Batch mode overrides collapsed state and blocks collapse; exiting batch restores the previous disclosure preference. Both group labels/counts render when one group has zero entries on a nonempty filtered page.
- Global mode retains node ownership as the outer hierarchy. `groupedTableTreeData` is computed from `tableTreeData`; each node has two synthetic group rows followed by its original Load More row. Only rows carrying `inst` reach `InstanceLine`. Synthetic/node rows never initialize instance action hooks. Disclosure keys remain stable over refresh.
- `ServerSourceBadge.vue` reuses the existing CurseForge, Modrinth and FTB assets used by the marketplace. Badges require exact provider metadata; no filename, icon, loader or import-origin inference.
- `BackupList.vue` keeps ten-entry pagination with clamping after deletion. Each entry leads with a kind chip, localized time and binary size; secondary filenames wrap anywhere, and action controls wrap in the available panel width. It emits the original API record to the unchanged Backups download/restore/delete handlers. Existing confirmation text remains in use; restore stays disabled during a task. No storage names, paths, task logic, permissions, exclusions or payloads change.
- `backupPresentation.ts` accepts `world-YYYYMMDD-HHmmss[.zip]` and `backup-YYYYMMDD-HHmmss[.zip]`, with an optional hexadecimal UUID suffix before the extension. Includes screenshot examples `backup-20260923-081201.zip` and `world-20260923-080509.zip`. Unrecognized or prefixed/path-like names are Unknown. The label reflects naming convention and does not verify archive contents or promise inclusion of excluded files.
- English catalog handoff: `frontend/node_modules/.cache/nexcraft-preview/group-backup-strings.json`, six unique namespaced keys. The language source catalog is owned by another worker.

## Integration status

The parent's reviewed global overview is consistent with this scoped implementation. Components are wired and the English fragment is ready for the parent's coordinated preview at 4181. No preview server, production rollout or Quick Settings backend change is included. Parent owns final desktop/mobile and light/dark visual verification and integrated build.
