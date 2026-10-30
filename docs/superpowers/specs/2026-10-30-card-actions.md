# Approved server card actions — 2026-10-30

The user reviewed the private tag-placement mockup, asked to align the top-right Tag/Delete icons with the first title line, and then chose icons plus text for power controls. They withdrew the request to force one row after noticing their window was squished. They explicitly approved applying this design and pushing to test.

Move the existing single native Tag/Delete component to the top-right of each server card, aligned with the first server-name line, including wrapped names. Keep icon-only organization controls and accessible labels, tooltips and mobile hit areas. Reserve header space so titles and tags do not collide. Cover Compact, List and Overview and Java, Bedrock and other instance types.

Footer controls retain icons and show their existing translated labels: Console, applicable Start/Stop, Restart, Terminate, and configured Update where supported. Preserve readable spacing, normal one-row presentation when it fits and natural wrapping on narrow cards. Do not force smaller labels, hide actions or introduce overflow. Remove the footer utility divider and duplicates.

Keep native permissions, confirmations, EULA checks, target/generation fences, batch/design behavior, data subscriptions and metadata click delegation. Preserve the status rail, server data and Base Information's separate organization controls. This is a presentation change; do not add requests or alter server operations.

Validate the actual native card at desktop/mobile widths, long names, all layouts, and dark/light themes. Update the preview synopsis. Commit and push test after appropriate local checks, require exact-commit hosted production browser and shipping-image validation, then dispatch the already-authorized test GHCR workflow. Do not monitor GHCR or promote main.
