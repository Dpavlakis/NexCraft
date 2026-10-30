# Server organization and settings — design specification

Date: 2026-10-29. Checkout: D:/Projects/NexCraft, branch test.
Status: native Vue preview work; visual acceptance and rollout remain pending.
This is the reviewed integration of the planning agent's draft.

## Purpose

Make routine server management simple within NexCraft's existing visual system. User-confirmed live acceptance of #3/#4 precedes this work. Preserve branding, permissions, data identities and operational confirmations. The user explicitly requested a visual preview before rollout and "Show the design first; choose controls afterward" for Quick Settings.

## Server groups

Show Modpack Servers then Custom Servers, initially open. Classify only stored packInfo.source: curseforge, modrinth and ftb are modpacks; other, missing or unrecognized values are Custom. Do not guess origin from names, icons or loader. Show provider badges only for known sources.

Counts describe the loaded filtered page. Preserve order, pagination, filtering, refresh and #4 selection ownership. Disclosure headings support keyboard focus and expanded state. Batch mode unfolds both groups so selectable page cards cannot be hidden.

Global view keeps daemon ownership as the outer hierarchy. Any group projection leaves the raw tree, node IDs and Load More/refresh logic intact, with synthetic rows handled separately from real instances. If this cannot remain narrow, retain the current global tree and report that limitation.

## Configuration

Server configuration opens the parsed server.properties editor directly. There is no intermediate configuration-file list, General prefix, EULA entry or Advanced-files selector in this flow. Other files, including eula.txt, remain accessible through File Manager. Keep explicit Save, Refresh and raw-source access, and return to the instance context rather than a removed file list.

LineOption gains a default-off boolean-switch opt-in used by InstanceConfigEditor. Only native boolean values become rounded switches with visible Yes/No and accessible labels. Other callers, custom slots, strings including "false", numbers, empty values and long/float markers retain their behavior.

Remove the permanent server.properties/restart hint from Basic Info, preserving missing-endpoint help, address copying and protocol. Before a changed server.properties save, show contextual confirmation: changes apply on the next start; a running server needs a restart. Cancel sends no write. No automatic restart. No-op/unrelated-file saves do not show this warning. Cover parsed Save and raw Save/Ctrl+S without treating Cancel's dialog resolution as a saved result.

## Backups

Display prominent World backup / Server backup badges, with neutral Unknown for unrecognized names. Recognize source-confirmed generated names, including legacy timestamp names without UUIDs and current UUID suffixes. Labels describe known naming conventions, not verified archive manifests.

Keep exact names as storage/action identity. Server backups follow exclusions; do not promise every file. Preserve pagination, download, restore/delete confirmations and task behavior. Keep readable time/size, wrapping filenames and reachable actions in a narrow panel and at 390px, without horizontal clipping.

## Java

Distinguish Installed/Downloading, Selected for this server/next start, and actual running usage. A saved selection cannot migrate an existing JVM. Refresh authoritative configuration/startup command after acknowledged selection. Do not call an installed runtime Stopped or equate configured ID with running usage.

Custom scripts control their own Java unless explicitly supported; no blanket warning against Unraid's daemon container. Backend validation, quoting, reference/deletion tracking and persistence are covered by the separate Java selection fix. Existing characterization tests proved defects, not blanket correctness or cross-major compatibility.

## Quick Settings concept

Private preview only, with clearly proposed controls and local fixture state. Candidate layout can demonstrate game mode, difficulty, whitelist/allow-list, max players, PvP and view distance. The user chooses which controls to implement after seeing the design. No production page, new endpoint, server command or live write is authorized by this concept. Show edition differences honestly; do not imply unverified Bedrock capabilities or that the existing narrow property endpoint already supports these controls.

## Preview and verification

Use http://127.0.0.1:4181/ with actual Vue components, existing theme tokens, intercepted fixtures and a visible sample-data banner. No NAS/provider calls or live mutations. Inspect desktop 1440px/mobile 390px, light/dark, keyboard navigation, grouping/batch visibility, boolean payloads, cancelled warnings, long backup names/actions and Java states. Record actual results and limitations before requesting visual acceptance.

## User feedback — layout exploration, 2026-10-29

The user approved the backup presentation and liked the three-section Quick Settings design, but asked where Quick Settings would appear. Quick Settings placement and actual supported controls remain proposals until reviewed. Show a sample instance overview with Console above Basic Information plus Quick Settings, and management tools below; preserve a clear route to full settings.

Explore three private visual alternatives for the server list cards and Basic Information: aligned compact cards, a dense row/list view, and roomier overview cards. Improve label/value alignment, spacing, long-name wrapping, metadata/chip grouping and action hierarchy. Avoid far-separated values across a full-width panel and redundant address/port/version presentation; keep technical IDs and secondary dates available under details. Use the existing NexCraft visual language in light/dark and mobile/desktop. Do not alter the approved backups or publish a design selection.

Remove the redundant [General] prefix in the proposal. It is a translated shared configuration-catalog label, not part of the real filename or a distinct server section. Show Server properties with server.properties secondary and a concise description. The Java builder writes eula=true when acceptEula is set; quick install and import finalize also write it, and the existing start path prompts if a readable eula value is false. Keep eula.txt available under Advanced files instead of as a prominent routine setting. This changes proposed presentation only, not consent, installer or startup behavior.

Presentation requirement from the user: include a short synopsis of changes whenever presenting updates. State what changed, its practical benefit, which parts are proposals and the remaining design decision. Present the comparison preview before any product implementation or rollout of these additional layout changes.

## Toolbar layout selector — user decision

Keep all three proposed server layouts available instead of choosing a single layout for everyone. The user requested a three-button segmented slider in the existing server-list toolbar, and then explicitly required icons only with no visible button text. Use distinct Compact, List and Overview icons, selected indication, tooltips and accessible names. Preserve Batch Operation/Refresh on the left and pagination/page-size on the right. Remember the selected layout locally with graceful storage fallback; retain responsive keyboard/touch behavior. This remains an isolated preview pending review, not authorization to publish product changes.

## Basic Information refinement — user feedback

The user approved the three-icon toolbar selector ("love that") and then requested further refinement of the standalone Basic Information tab. That tab was still mounting the legacy native BaseInfo, while the layout comparison contained a cleaner proposal. Update the private standalone tab to the refined proposal so the reviewed page reflects the intended design. Consolidate identity/status/address, bound label/value alignment, group game data, preserve differing installed/running version facts, and move activity/IDs into accessible disclosures. Preserve copy actions and missing-data/stopped behavior. Do not treat this feedback as a request to change the approved toolbar or publish product code. Include a short synopsis when presenting the revised tab.

## Synopsis requirement — applies to every preview

The user clarified that every change needs the collapsible in-page Preview synopsis shown in the layout comparison, not only a summary in chat. Add one consistent synopsis to every preview tab: Servers, Configuration, Backups, Quick Settings, Basic Information, Java, Layout options and Instance overview. Briefly explain the actual changes, practical benefit and current proposal/approval status. Avoid duplicate nested synopsis bars or claiming that a proposed change is already present on a native baseline view. Keep the control accessible and mobile-friendly; maintain a concise synopsis in presentation messages too.

## Configuration navigation — superseding user decision

The user simplified the flow further: Server configuration should open server.properties directly, without an intermediate configuration-file list. eula.txt remains accessible through File Manager, so the earlier proposal to show it under Advanced files within Configuration is superseded. Preserve the parsed editor's boolean switches, explicit save/raw source access and contextual restart guidance. Update the Configuration preview and synopsis to demonstrate this direct flow; do not change EULA values or acceptance behavior. Remove stale Advanced-EULA wording/examples from the layout comparison. The latest Basic Information refinement is approved ("looks much better").

## Instance actions — restore in the preview before deciding placement

The user likes the new server layouts but noticed that the regular list previously offered quick tagging and deletion. They want that access retained and noted that Basic Information has no deletion action either. Proposed preview: keep Console and power actions primary, restore small Tag and Delete icons as secondary list actions in all three layouts, and offer Edit tags/Delete server in a secondary menu on Basic Information. The user explicitly requested to see this first; placement remains a proposal until reviewed.

Mirror the existing deletion choices: remove the instance while retaining files by default, with an optional delete-files checkbox and the existing second confirmation for deleting files. Do not invent a typed-name requirement or stopped-only UI restriction. Show the selected server identity clearly. The private preview must not execute deletion, alter sample server records, change actual tags or issue mutation requests. Preserve the approved toolbar, Basic Information and backup designs, direct server.properties navigation and all-page synopses.

## Quick Settings benchmark — choice pending

The user asked which controls other Minecraft hosts commonly expose instead of approving the initial six. Official Shockbyte documentation describes an overview Quick Settings panel with game mode, difficulty and render distance, plus a full properties editor. Aternos/exaroton options and BisectHosting's Java properties guide also cover allowlist, maximum players, PvP, force game mode, command blocks, spawn protection, resource packs and related settings. The parent recommended keeping the three approved sections with the original six controls plus simulation distance, then asked which set to implement. This recommendation is not user approval; the control/placement choice remains pending until answered.

Sources checked 2026-10-29: https://shockbyte.com/help/knowledgebase/articles/how-to-configure-your-minecraft-server-serverproperties ; https://shockbyte.com/help/knowledgebase/articles/changing-view-and-simulation-distances-on-a-minecraft-server ; https://support.aternos.org/hc/en-us/articles/360030513552-The-options-of-your-server-explained ; https://help.bisecthosting.com/hc/en-us/articles/40210478468891-Minecraft-Java-Server-Properties-Guide . Availability varies by edition, version and software; do not infer universal capabilities from a host's UI list.

## Quick Settings — approved controls and placement

The user selected "Seven controls, including simulation distance" for Quick Settings below Console beside Basic Information. Implement the approved Gameplay, Access and World sections with game mode, difficulty, PvP, allowlist, maximum players, view distance and simulation distance. Show only controls supported by the edition and actually available in the properties file. Java uses white-list/simulation-distance; Bedrock uses allow-list/tick-distance and does not acquire a fictitious PvP property. Use native file permissions, captured target identity and explicit Save with contextual restart guidance; no automatic restart or live-command assumption.

Reuse the existing properties read/write endpoint, force a fresh read before Save, merge only dirty approved fields and preserve unrelated data/Java encoding. Reject detected same-field conflicts rather than blindly overwriting a newer value. The legacy full-object endpoint is not an atomic cross-request compare-and-swap, so document that limitation rather than claiming concurrent-editor transactions. Do not add network/authentication/rate-limit controls or unrelated properties. Register the real widget and routes. Migrate only recognisable stock terminal layouts to the approved placement; keep custom layouts intact and provide a reachable Quick Settings entry.

References for edition keys/values: https://learn.microsoft.com/en-us/minecraft/creator/documents/bedrockserver/server-properties?view=minecraft-bedrock-stable and https://docs.papermc.io/paper/reference/server-properties/ . Bedrock tick-distance is 4–12; its view-distance is at least 5; gamemode is survival/creative/adventure. Use real file presence/version support rather than assuming every Java/Paper property exists on every server.

## Integration correction — truthful deletion acknowledgement

Review found that the existing deletion response contains requested UUIDs plus a list of actually deleted instances, while the frontend type incorrectly claimed string[] and the dialog treated any HTTP success as deletion. Require the intended UUID in the confirmed deleted-instance list before reporting success. The panel must remove user-instance associations only after daemon acknowledgement and only for confirmed requested IDs, preserving associations when deletion fails. Keep role checks, native confirmation choices and daemon stop/delete policy unchanged. Add focused empty/mismatched/partial/failed acknowledgement regressions rather than broadening the audit.

## Integration correction — preserve properties text

Actual ProcessConfig write/read tests exposed two legacy issues: the frontend Unicode helper truncated hexadecimal code points, and the daemon's global backslash-u rewrite changed literal text (including Windows user-directory paths). Fix the helper. Introduce explicit properties format variants for the new editor flows that use the existing serializer without the legacy rewrite; preserve old format behavior for older clients and bookmarked routes. The new formats send ordinary decoded strings, with Java Unicode output and BDS UTF-8 output selected by the writer. Reject missing/invalid parsed reads before enabling Save, including an older daemon that does not understand the new format. Exercise the real serializer twice with international text, emoji, literal escapes and backslashes. No new visible controls, dependencies, endpoint, restart action or authentication policy is required.
