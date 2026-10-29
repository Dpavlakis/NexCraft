# Server organization and settings — implementation plan

Date: 2026-10-29. Checkout: D:/Projects/NexCraft, branch test.
Specification: [design specification](../specs/2026-10-29-server-organization-and-settings.md).
Status: implementation and isolated preview in progress; no rollout.

1. Build the native Vue preview at http://127.0.0.1:4181/ using intercepted sample APIs. Quick Settings is a private candidate layout only. Keep the existing preview at 4180 available.
2. Group the existing current-page instance cards using stored source metadata. Add source badges and accessible disclosures. Preserve daemon/query/generation guards and expand groups during batch selection. Keep the global daemon hierarchy and raw tree intact.
3. Improve backup type/name/metadata/actions presentation without changing archive identities or operational payloads. Recognize legacy and current generated names; unknown names stay neutral.
4. Open Server configuration directly in the server.properties editor; keep other files, including eula.txt, in File Manager. Opt only InstanceConfigEditor into LineOption boolean switches; preserve other control/value contracts.
5. Move restart guidance from Basic Info to changed server.properties saves, including parsed and raw keyboard paths. Cancel must not save; no automatic restart.
6. Clarify Java installation, saved selection and next-start behavior using the separate backend verification/fix handoff. Refresh authoritative state; never display success after rejection.
7. Merge unique English string fragments through the assigned catalog owner. Preserve other workers' disjoint changes.
8. Run meaningful scoped interaction/regression tests, final type/build checks and desktop/mobile light/dark visual QA. Inspect actual screenshots and console/network failures. Broaden testing only when changes or failures justify it.
9. Present the concrete preview for user review before any push/publish/deployment. Quick Settings control selection remains open.

Detailed feature contracts and task records:
- [Grouping and backups](2026-10-29-server-grouping-and-backup-presentation.md).
- [Configuration and Java presentation](2026-10-29-config-interactions-and-java-presentation.md).
- [Java behavior verification](2026-10-29-java-selection-verification.md).
- [Navigation throttling fix](2026-10-29-navigation-throttling-fix.md).

Workers implement separate file scopes with Sol 6.1. The parent integrates and reviews. These assignments do not create additional human approval restrictions; the user explicitly requires the visual review before rollout.

## Parent checkpoint — ready for visual review

The grouping, backup presentation, config switches/save warning and Java UI/backend fixes are implemented locally. The user chose the three-section Quick Settings concept; actual controls and implementation remain undecided. The sample-only native Vue preview is available at http://127.0.0.1:4181/ (groups, configuration, backups, basic information, Java and Quick Settings). Final preview evidence: 48/48 render/interaction checks at desktop/mobile widths and light/dark, with 24 native states and four global states. Outbound/backend requests and mutations are blocked. Parent inspected native desktop groups/Java and mobile backups/configuration; Java/global tables retain internal horizontal scrolling on narrow screens.

Local validation: config/account 59, reliability 138 and grouping/backup 54 frontend cases pass (251 total), plus production frontend/daemon/panel builds. The final navigation-policy correction subsequently passed 318 backend cases including the pending 35-case Java suite, panel compilation and frontend type checking. Java checks used real installed Java 21 executables on Windows/Linux plus mocked launcher/race failures; cross-major Minecraft compatibility was not live-tested. This is not a claim of universal correctness or compliance certification.

Urgent publication was separated from this batch. Test commits f56a2dc3 and 095805b2 contain only the Web navigation/request-lifecycle fixes and the user-approved removal of authenticated generic throttling. Ordinary signed-in panel use is not rate-limited; anonymous login admission and independent credential-proof protections remain. No grouping/config/backup/Java product source or design workflow change was staged with those commits. Required hosted CI and test GHCR publication are tracked separately; main stays unchanged. Resume this batch with user review of the concrete local preview before any rollout.

## Layout alternatives preview — handoff

Ready at http://127.0.0.1:4181/?view=styles&layout=a&mode=dark with A Aligned compact (recommended), B Dense rows and C Overview cards. Placement proposal: http://127.0.0.1:4181/?view=placement&mode=dark . Improvements include bounded label/value alignment, grouped metadata, explicit Console/power actions, secondary activity/technical disclosures, a clean Server properties entry and eula.txt under Advanced files. Quick Settings is shown beside Basic Information below Console, with Manage Instance below. Approved backups were not changed; all variants remain private proposals pending selection.

Preview-only QA passed 16 desktop/mobile/light/dark states plus keyboard tabs/focus, isolated clipboard confirmation, disclosures, editor navigation, theme and long-name/address checks. No runtime errors or overflow; API/write/upload/socket probes returned 403. Parent inspected A/B/C desktop, mobile A and placement screenshots, then requested and inspected C's corrected footer alignment. Evidence remains under the ignored design-20261029 preview folder (layout-results.json, layouts-*.png). No product source, Git commit, publish or deployment was part of this layout exploration.

One early automated copy-button run copied sample.invalid:25565 into the OS clipboard. Final automation uses a page-local clipboard stub; no original clipboard content was read or restored. Inform the user of this testing side effect with the handoff.

## Icon-only layout toolbar — preview scope

The user explicitly wants all three layouts selectable from a single segmented control in the instance-list action bar. Limit this preference to list presentation rather than treating it as a global theme choice. Use icons only (with tooltips/accessibility labels), a clear selected segment and a local saved preference. Future product integration should reuse instance data, target/selection guards and mounted summaries where possible, so a layout change does not trigger another round of server/provider requests. The current task changes the private preview only; product implementation and release still follow review.

Toolbar selector preview is ready at http://127.0.0.1:4181/?view=styles&mode=dark . Large A/B/C choice cards were replaced by an icon-only segmented selector beside the list actions and before pagination. All three layouts remain, with sliding highlight, tooltips/accessibility labels, keyboard support and guarded local persistence. Parent inspected desktop-dark/mobile-light crops. The focused preview run passed all 12 layout/viewport/theme combinations plus keyboard, persistence/override/fallback, scroll, reduced-motion and local-refresh assertions (86 checks); no overflow, browser errors or toolbar network requests. Only ignored preview files changed. Product integration/deployment remains pending review.

## Standalone Basic Information and shared synopsis — reviewed preview

The Basic Information tab now opens the refined private panel at http://127.0.0.1:4181/?view=info&mode=dark . Identity/status, copyable address, aligned Server/Game fields, stopped/unknown states and expandable Activity/Technical details replace the legacy stretched list. Known fixture-only version markers are removed for comparison, avoiding a duplicate default Minecraft row while retaining genuinely different installed/running versions. The panel responds to narrow 400–440px desktop columns as well as 390px mobile. The parent inspected wide/narrow captures and the final default-version correction.

One shared collapsible Preview synopsis appears on all eight tabs, with concise Changed/Benefit/Status explanations and factual approval state. Duplicate inner bars were removed from Layout options and Instance overview. The approved icon-only three-layout toolbar is preserved. Preview-only browser checks cover panel layouts, copy controls using page-local stubs, disclosure keyboard behavior, all eight synopsis bars, embedding and version cases; native Servers lifecycle warnings remain recorded. No product source, commit, publish or deployment was part of this refinement. Evidence: qa-basic-info-report.json, qa-preview-synopsis-report.json, qa-basic-info-version-report.json and basic-info-*.png under the ignored design-20261029 folder.

## Direct configuration preview — handoff

The actual Server configuration tab now opens native server.properties directly at http://127.0.0.1:4181/?view=config&mode=dark . The intermediate file list, General prefix and EULA/Advanced-files selector are gone from this flow; eula.txt stays in File Manager. Back returns to the instance overview. Configuration and Styles synopses and the matching example reflect this superseding decision. Parent inspected desktop-dark and mobile-light captures.

Focused preview QA passed direct cold and legacy entry, correct sample context, switches, changed-save warning/cancel, Styles entry links, one synopsis, other approved view preservation and responsive rendering. Raw access remains the native control, but raw fixture reading was not tested because this preview has no raw-content fixture. No product source, commit, push or deployment was made. Evidence: qa-config-direct-report.json and config-direct-*.png in the ignored design-20261029 preview folder. During future product integration, select the existing instance-type-specific server.properties definition (for example bds/server.properties for Bedrock) and real instance data rather than copying this Java-only fixture mapping.

## Restored instance actions — preview handoff

Ready in all three server layouts at http://127.0.0.1:4181/?view=styles&layout=c&mode=dark and the proposed Basic Information ellipsis menu at http://127.0.0.1:4181/?view=info&mode=dark . Card footers retain Console/power as primary controls, with secondary icon-only Tag/Delete at the edge. Shared private ServerActionsPreview.vue presents the correct sample identity, draft-only tag editing, default instance removal with files kept, and the existing additional confirmation when files are included. Final actions display a preview notice, preserve sample records/tags/files and send no mutation requests. These action placements remain proposals; the user explicitly requested to see them before product changes.

Parent inspected Compact/Overview cards, the Basic Information menu, default deletion dialog and the mock completion code. The first keyboard-menu checks exposed four failures; the corrected focused run finished with empty failures/errors and 202 passing assertions across 12 layout/viewport/theme states, menu keyboard use, mobile touch, target identity, cancellation and both deletion choices. Both existing preview servers remain alive; all changes stay inside the ignored preview folder. Shared synopses reflect approved layouts/Basic Information with the added actions marked proposed. No product source, Git commit, push or deployment was made.

## Approved design integration — execution

The user approved the restored quick Tag/Delete placements after preview. Implement the approved designs in real test-branch components: all three server-list layouts with the icon-only persisted selector; Modpack/Custom grouping; native Tag/Delete actions in every list layout and Basic Information's secondary menu; the approved aligned Basic Information with activity/technical disclosures; direct edition-appropriate server.properties configuration; approved backup presentation and Java fixes already staged locally. Preserve native permission checks, target/selection generations, API response guards, confirmations, installation/runtime semantics and accessibility. No generic signed-in throttle is reintroduced.

1. Server-list worker owns InstanceList/Shortcut presentation, shared native secondary actions, optional delete-target identity plumbing, its focused tests and a private English-string fragment. Reuse the existing hooks and action implementations; changing view is presentation-only, and refresh/filter/batch/global node ownership must remain correct. Keep restart/kill/update accessible rather than losing existing actions.
2. Information/configuration worker owns BaseInfo, configuration overview/editor navigation, their focused tests and a separate English-string fragment. Consume the shared secondary-action component through the agreed props/events. Use real game endpoint/version/runtime data; never copy fixture-only helpers. Use existing instance-type property definitions and context-sensitive return behavior.
3. Parent merges English fragments once, reviews worker diffs/contracts and validates the complete integrated source. Existing local Java, backup and configuration-switch fixes are preserved. Preview sources stay ignored; no sample values or preview mutation guards enter production code.
4. Quick Settings control/placement selection was asked asynchronously because the user previously reserved that choice until after the design. Independent approved work proceeds while that answer is pending; do not infer the unanswered control selection.
5. Refresh the isolated preview with actual integrated app components and inspect desktop/mobile light/dark states before any release. Run focused regressions and necessary final builds/security tests once on the final source; broaden only for changes/failures.
6. Commit/push only reviewed app changes and relevant docs/tests to test. Complete required hosted CI before the already-authorized test GHCR publication. Main remains unchanged. Report affected images, a concise synopsis, test evidence and practical limitations; do not watch the GHCR publish after dispatch.

## Local integration validation — ready for test publication

Approved controls are implemented: Gameplay (game mode, difficulty, PvP where present), Access (allowlist, maximum players), and World (view and simulation distance). The normal terminal layout places Quick Settings beside Basic Information; only recognizable stock layouts migrate, and custom arrangements retain a Manage entry. Server configuration opens properties directly. Native tags/delete confirmations remain available in all three list modes and the Basic Information menu. Stopped cards suppress stale metrics.

Local final checks: 359 security tests, 59 account/configuration tests, 138 reliability tests and 266 settings/presentation tests pass (822 total). Daemon and panel builds plus the frontend type-check/production build pass with the pinned Node runtime. Existing Sass deprecation/chunk-size warnings and test/preview lifecycle warnings remain recorded; these checks are not a claim that the entire legacy codebase is warning-free. A TOTP boundary fixture was made deterministic, and the native-page loader now resolves the shared action import without bypassing the real list/cards/API cache.

Real properties serializer tests cover Java and BDS Unicode, literal backslash-u text, Windows paths, separators, unrelated fresh values and a second write/read cycle. Older clients retain legacy format behavior; the new default flows require matching Web and Daemon versions. Missing/invalid parsed reads block Save. Quick Settings checks a fresh object and rejects detected dirty-field conflicts; the existing full-object endpoint still is not atomic across concurrent writers.

Publication gate: keep changes on test. Required clean-source security-validation CI must pass, including cold production-browser boot and both shipping-image build/start/stop smoke checks, before the authorized test GHCR workflow is dispatched. Do not monitor GHCR or promote main. Unraid verification remains necessary for live Java selection/start behavior and the user's actual server/plugin/version combinations.

Final preview alignment: the native placement preview uses the shipping 4/8 Basic Information/Quick Settings grid, native in-card titles and a 470px Manage area. New and recognizable migrated stock layouts retain that management height after moving the tools to their own row; custom layouts remain unchanged. The 26 migration regressions pass after this metadata-only adjustment, and the panel is rebuilt. Earlier local suite totals are unchanged.
