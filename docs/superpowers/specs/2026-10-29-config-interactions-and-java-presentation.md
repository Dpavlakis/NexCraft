# Configuration interactions and Java presentation

Date: 2026-10-29. Scope: assigned frontend files and English catalog in D:\Projects\NexCraft on test. Parent requirements are already brainstormed; parent coordinates preview before rollout.

Use the existing compact operational styling. Configuration file entries are one semantic, keyboard-accessible row button with readable descriptions. Only InstanceConfigEditor opts into rounded boolean switches, visible Yes/No, and a field label. Preserve other LineOption callers and all nonboolean/raw value types and explicit Save.

Confirm only changed server.properties saves, both structured and raw including Ctrl+S. Explain next start and running-server restart, without stopping or restarting automatically. Cancel writes nothing; pristine saves and other formats do not prompt. Preserve legacy FileEditor promise/event behavior. Remove only the configured Basic Info source/restart hint; retain missing endpoint help and polling.

Java rows distinguish Installed/Downloading, configured selection for next start, and runtime usage from usingInstances. Update selection and report success only on boolean true acknowledgement. Explain custom script launchers and backend rejection accurately; preserve Add/Download/Delete and confirmation, prevent concurrent actions, never restart automatically.

Quick Settings controls remain pending design preview. No Quick Settings/backend/API service/package changes. Other workers own Java backend, API recovery, preview, and grouped backups. English catalog is owned here; merge their unique-key fragments when parent requests.

Acceptance: focused meaningful interaction tests cover boolean/nonboolean payloads, row activation semantics, save confirmation cancellation/raw Ctrl+S/properties-only behavior, Java false/error/stable selection and action guards. Parent owns the single integrated build and browser QA on 4181.

Follow-up contract: after a true Java selection acknowledgement, force-read getInstanceInfo and merge only its saved config.java.id and config.startCommand into the caller's existing configuration snapshot. Preserve unrelated unsaved fields and running-process presentation. A read failure retains the known accepted ID, displays explicit saved-but-refresh-needed guidance, and permits a read-only Refresh retry. Rejected/false writes do not change fields or trigger that read. Guard read continuations against replacement/unmount; preserve edits to the startup command made during the read and request reconciliation rather than overwriting them.
