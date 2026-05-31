# Import an Existing Server — Design

**Status:** Approved design (brainstorm complete) — ready for implementation plan.
**Date:** 2026-05-30

## Goal

Let a user bring an existing Minecraft server (from Crafty, Pterodactyl, a raw
folder, or a modpack export) into NexCraft by uploading a `.zip`. NexCraft
auto-detects the loader, Minecraft version, start command, and world; optionally
identifies the modpack so it can be linked or reinstalled fresh while keeping the
world. The user's builds and progress (the `world/`) always survive.

**North star:** turn "move my server in without losing anything" into a short,
guided wizard — and serve as an adoption on-ramp now that NexCraft is public.

## Scope

**In scope (v1, all-in-one):**
- Zip-upload import only (no disk-path source).
- Auto-detection of loader + MC version + start command + world name.
- Pack identification (CurseForge fingerprint, Modrinth index, manifest name-search).
- Three outcome modes: **Import as-is**, **Link to pack**, **Reinstall fresh + keep world**.
- **Java Edition and Bedrock.** (Bedrock = import-as-is only; no pack-ID/reinstall.)
- Admin-only (ROLE.ADMIN).

**Out of scope (v1):**
- Disk-path / folder-on-daemon source (zip only).
- Keeping the old `config/` on reinstall (fresh pack configs only).
- Bedrock pack/addon identification.
- A dedicated "migrate from <panel> X" importer — to NexCraft every source is just a server folder.

## Approach (chosen: A — smart wizard + shared detection)

One entry (the existing **Import Compressed Package** card, enhanced). Upload →
daemon unpacks + detects → editable **review screen** → user picks one of three
outcomes. Rejected alternatives: two separate entries (worse UX, duplicated
upload/detect) and auto-everything-no-review (silent wrong guesses cause exactly
the confusing breakage we want to eliminate).

## End-to-end flow

1. **Minecraft → Import** → upload a `.zip`.
2. Panel → daemon **import task**: create a new instance folder, unzip into it
   (zip-slip-guarded; flatten a single nested top dir to handle Crafty's
   timestamped wrapper), run **detection**, save a *draft* instance (stopped,
   `type=minecraft/java` or `minecraft/bedrock`, detected start command). Return
   `{ instanceUuid, detected }`.
3. Frontend shows the **review screen**. In parallel the panel runs **pack
   identification** and returns a `packGuess` + available versions (Java only).
4. User picks an outcome:
   - **Import as-is** — confirm/keep the detected start command.
   - **Link to pack** — write `packInfo` (no file changes); Update card now works.
   - **Reinstall fresh + keep world** — write `packInfo`, then run the existing
     `ModpackUpdateTask` to the chosen version (auto-backup → swap files →
     preserve world/settings → re-bootstrap).
5. Route to the instance terminal.

## Components (each one job)

### Daemon
- **`service/server_detect.ts` (new)** — pure, read-only inspection:
  `detectServer(dir) → { kind: "java"|"bedrock", loader?, mcVersion?, startCommand?, worldName, manifest? }`.
  - Branches Bedrock vs Java first (Bedrock = a top-level `bedrock_server` binary).
  - **Refactor:** extract the artifact-detection currently inside
    `ModloaderBootstrap.detectStartFromExisting` into a shared function so the
    bootstrap and the detector use one source of truth.
- **`service/async_task_service/server_import_task.ts` (new)** — unpack + detect +
  create the draft instance (modeled on `ModpackInstallTask` / `QuickInstallTask`).
- **Reinstall-keep-world reuses** `ModpackUpdateTask` (which already does
  backup → stop → delete replaceable artifacts while `shouldPreserve` protects the
  world + settings → place fresh files → re-bootstrap → update `packInfo` →
  restart). No new install logic.
- **Fingerprint util** — murmur2 hashing of mod jars for CurseForge matching.

### Panel
- **`routers/import_router.ts` (new)** — drive the import task (proxy to daemon),
  poll status, and run pack identification. Reuses `mod_manager_service` (+ new
  `matchFingerprints()` and manifest/index → project resolution).

### Frontend
- Enhance the Import entry into a **wizard**: upload → poll detect → editable
  review form → mode select → finalize. New API service methods + i18n keys.

## Detection details

### Java (`detectServer`)
- **Start command:** shared artifact-detector — Forge/NeoForge `*_args.txt`
  (`@user_jvm_args.txt @<rel> nogui`), run scripts (`run.sh`/`.bat` etc.), legacy
  `forge|neoforge-*.jar` universal jars, `fabric-server-launch.jar` /
  `quilt-server-launch.jar` — **plus a new vanilla/Paper fallback**: a top-level
  server jar (`server.jar`, `paper-*.jar`, `purpur-*.jar`, or the jar named in
  `fabric-server-launcher.properties`) → `{mcsm_java} -Xmx… -jar <jar> nogui`.
- **Loader:** inferred from which artifact matched.
- **MC version:** sniffed from `versions/<v>/server-<v>.jar`, Fabric/Quilt metadata,
  Forge/NeoForge library paths, or `version.json` inside the vanilla jar. Unknown
  is acceptable — left blank for the user on the review screen.
- **World name:** `level-name` from `server.properties` (default `world`).
- **Manifest:** detect CF `manifest.json` / Modrinth `modrinth.index.json`.

### Bedrock
- **Detect:** a top-level `bedrock_server` binary.
- **Set:** `type = minecraft/bedrock`; start command
  `sh -c "LD_LIBRARY_PATH=. exec ./bedrock_server"`; `chmod +x bedrock_server`.
- **World:** `worlds/<level-name>/` (level-name from Bedrock `server.properties`).
- **Port:** `assignFreeBedrockPort(instance)` (UDP pair).
- **MC version:** not reliably sniffable — left blank. No pack-ID, no reinstall;
  Import-as-is only.

## Pack identification (Java only; strongest signal first)

1. **Fingerprint** mod jars (murmur2) → CurseForge `/v1/fingerprints` → exact match
   returns the pack's `modId` + `fileId` → exact project + version → available
   versions via existing `getCurseForgeModpackVersions`.
   - **Risk / spike:** confirm `api.curse.tools` proxies the fingerprints endpoint.
     If not, skip to #3.
2. **Modrinth:** if `modrinth.index.json` is present, file download URLs embed
   `…/data/<projectId>/versions/<versionId>/…` → extract project + version directly.
3. **Name-search fallback:** read the pack name from the manifest → search CF/Modrinth
   modpacks → present likely matches for the user to confirm.
- Output: a `packGuess { source, projectId, projectName, version?, confidence,
  availableVersions[] }`, or `null` → only *Import as-is* is offered.

## The three modes (thin layers)

- **Import as-is** — finalize the draft with the detected (or user-edited) start command.
- **Link to pack** — write `packInfo` from the identified pack/version; files unchanged.
- **Reinstall fresh + keep world** — write `packInfo`, then run `ModpackUpdateTask`
  to the chosen version. Preserve set = the existing `shouldPreserve` predicate,
  **upgraded to honor the detected `level-name`** (world(s), `playerdata`,
  `ops.json`, `whitelist.json`, banned-*, `usercache.json`, `server.properties`,
  `server-icon.png`, `eula.txt`, logs/crash-reports). Fresh pack mods + `config/`.

## Review screen (frontend)

Editable form: instance name (default from zip), loader (dropdown), MC version
(blank if unknown), **start command** (editable textarea — the manual safety
valve), max memory, detected world (`level-name` + size), and the pack-ID result
(*"Looks like <pack> v<x> (CurseForge) — high confidence"* with a version dropdown,
or *"No pack identified"*). Mode buttons gated by `packGuess`: *Import as-is*
(always), *Link to pack* / *Reinstall fresh + keep world* (only if identified;
reinstall shows "auto-backup first, world & settings preserved").

## Error handling, security, edge cases

- **Admin-gated** (ROLE.ADMIN), like modpack install/update.
- **Zip-slip guard** on extraction (reject `..`/absolute entries); **flatten** a
  single nested top dir (Crafty wrapper).
- Detection finds no start command → instance is still created as a draft, but the
  review screen **requires a start command before "Import as-is" can finalize** —
  never a silently-broken instance.
- **EULA:** ensure `eula.txt=true` on import (Java) — it won't boot otherwise;
  consistent with how NexCraft accepts EULA elsewhere.
- **Port:** run the normal free-port assignment (`assignFreeMcPort` /
  `assignFreeBedrockPort`) and write it into `server.properties` so an import can't
  collide with an existing instance; surface the assigned port.
- **Reinstall:** mandatory pre-backup; abort if the backup fails (same as Update).
- Pack-ID failures are always **non-fatal** → degrade to *Import as-is*.

## Risks / caveats

- **Fingerprint endpoint** via the `api.curse.tools` proxy is unverified — a small
  spike in the plan; name-search is the fallback.
- **Large zips:** multi-GB modpack uploads through the browser are slow (accepted
  tradeoff of zip-only). Existing upload size/timeout limits apply.
- **Reinstall + world-version mismatch:** if the chosen pack version differs from
  what the world was built on, the world may log missing-content warnings (the
  harmless `ItemStack`/orphaned-block noise). The mandatory pre-backup is the net;
  surface a heads-up.

## Verification (manual — the gate)

Import each and confirm it runs / behaves:
1. Vanilla zip → detects `server.jar`, runs.
2. Paper zip → detects paper jar, runs.
3. Forge pack (1.17+ args) → detects args-file start.
4. Fabric pack → detects `fabric-server-launch.jar`.
5. Bedrock zip (`bedrock_server` + `worlds/`) → bedrock type + start, runs.
6. CF modpack export → fingerprint identifies pack + version; **Reinstall + keep
   world** preserves the world and lights up the Update card.
7. Modrinth-derived server → index identifies project.
8. No-manifest "zip of a running server" → fingerprint / name-search.
9. Unknown/garbage folder → draft created, requires manual start command, no crash.
10. Non-admin user → blocked.
