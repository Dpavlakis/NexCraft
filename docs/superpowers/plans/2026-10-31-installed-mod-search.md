# Execution plan — installed search and larger pages

1. Sol6.1 backend worker updates service list filtering and requested250 caps in RPC/panel, with meaningful full-list and transport/permission regressions.
2. Sol6.1 frontend worker connects header search to backend, owns paging/reset/request fencing and100/250 controls, with native hook/component regressions. File actions, deferred/upload queue and marketplace search retain their existing behavior.
3. Sol6.1 private-preview worker prepares isolated native ModManager samples while implementation proceeds; final capture only after source freeze.
4. Parent reviews contract, ordering, counts, permissions and stale-result behavior; merges any English fragment, runs appropriate integrated tests/builds, and presents the sample/synopsis.
5. Commit/push test with explicit paths after checks pass; wait exact-commit browser/container validation, verify remote test still matches, dispatch authorized test GHCR once and leave monitoring to the user. Preserve private/untracked files and main.

## Implementation and validation

- Full-list literal name/file query now passes through the owned-instance panel route and daemon RPC, before count and page slicing. Accepted pagination is returned and applied. Default remains50; options are10/20/50/100/250.
- Header search resets to page1 and retains query through Refresh, folder/page/size changes and post-action reload. Stale list/enrichment responses are fenced and aborted; native table has one pagination owner. Transfer polling remains active without overlapping slow requests.
- Parent integration review caught the existing50-hash metadata cap. Current-page batches now accept250, with actual-service tests proving sequential provider slices of50, complete enrichment, cache reuse and rejection above250.
- Pinned Linux checks passed:435 security cases;387 frontend settings/presentation cases (including22 new installed-search cases); daemon, panel and frontend builds/type checks. Existing tests were retained.
- Guarded native preview: installed-search-preview.html?mode=dark on localhost4181, with collapsible Changed/Benefit/Status synopsis. Desktop dark/light interaction verified Toast originally on page5 found from page1,100/250 real rows, selected-folder search, totals and query clearing. Narrow-screen search/reset verified; existing Ant mobile layout hides the page-size selector. Private captures are not shipped.
- Publish only test after exact-commit hosted production-browser and shipping-container validation. Matching Web and Daemon test images are required. Main remains separately approved.