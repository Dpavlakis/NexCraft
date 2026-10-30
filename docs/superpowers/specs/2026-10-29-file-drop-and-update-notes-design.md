# File drop feedback and modpack update release notes

Date: 2026-10-29
Branch: test

## File manager

Dragging files or folders over the file manager shows a steady overlay with an upload icon and a translated drop instruction. Crossing child rows must not toggle the overlay. Text drags do not activate uploads. The overlay must not change layout or intercept drag targeting. Dropping retains the existing upload confirmation and file/folder upload behavior. Clear drag state on exit, drop, cancellation, and unmount.

## Modpack updates

The Update Modpack dialog displays the publisher's release notes for the selected CurseForge or Modrinth version before updating. Label the selected version explicitly: these are that release's notes, not an aggregated diff from the installed version. Fetch through a panel API with validated provider/project/version identifiers. CurseForge returns HTML; Modrinth returns Markdown and must match the requested project. Never fetch caller-supplied URLs.

Render sanitized content using the existing marked and sanitize-html dependencies. Show loading, empty, and unavailable-with-retry states. Clear old notes immediately when selection changes and reject stale results. Bedrock's existing version update flow remains usable without calling the modpack endpoint. Notes must wrap in a bounded scrolling area and follow the current theme.

## Verification

Frontend type-check/build, panel build, focused checks of drag transitions/cancel and changelog sanitization/selection races. Publish the test branch and dispatch docker.yml on test after validation. Production promotion follows manual verification.
