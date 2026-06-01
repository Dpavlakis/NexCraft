# Richer Non-Modpack Install Detail — Design

**Status:** Approved 2026-05-31 (design + exact copy approved via the HTML mockup `docs/mockups/install-detail-30-mockup.html`). Ready for `writing-plans` → subagent-driven execution.
**Roadmap #30.** Branch: `test`.

## Goal
Make the modpack-browser **Details** tab for curated software (the `source === "custom"` builder) as informative as the modpack detail. Today it shows only logo + title + date + "Learn more" + a one-line blurb. Add a **tags row**, a **Key Features** list, and (Java software only) a **"Java auto-provisioned"** note.

## Scope
The 9 builder software types (the `customLoaders` values): `vanilla` (Java), `bedrock`, `paper`, `purpur`, `folia`, `fabric`, `forge`, `neoforge`, `quilt`. All content is **curated static** — no backend, no API calls, no fabricated hero image (the small loader logo stays in the head).

## What changes — `ModpackBrowser.vue`, custom-detail block (`source === "custom"`)
Keep the existing head (logo, `currentLoaderLabel() + dialog.item.id`, the `release · date` meta, "Learn more" link, blurb). Add, in order, after the blurb:
1. **Tags row** (`<a-tag>`, styled like the modpack `.pack-tags`):
   - the version (`dialog.item.id`) — blue tag,
   - the release type — `dialog.item.mcType` capitalized (Release / Snapshot / Preview),
   - the software's `categoryKeys` (see table).
2. **Key Features** — a heading + `<ul>` of the software's `featureKeys`.
3. **Java note** — shown only when `customLoader.value !== "bedrock"`: the string `TXT_CODE_loader_java_autoprovision`.

## Data model — `frontend/src/tools/loaderInfo.ts`
Extend each `LOADER_INFO` entry from `{ blurbKey, url }` to:
```ts
export const LOADER_INFO: Record<string, {
  blurbKey: string;
  url: string;
  categoryKeys: string[];   // i18n keys → category tag labels
  featureKeys: string[];    // i18n keys → Key Features bullets
}> = { ... }
```
Shared category i18n keys: `TXT_CODE_loader_cat_java` = "Java", `_cat_vanilla` = "Vanilla", `_cat_bedrock` = "Bedrock", `_cat_plugin` = "Plugin server", `_cat_modloader` = "Mod loader".
Java note key: `TXT_CODE_loader_java_autoprovision` = "Java is auto-provisioned to match this version — no manual setup needed."

## Curated content (authoritative — matches the approved mockup)

Blurbs reuse the existing `TXT_CODE_loader_blurb_*` keys; set their en_US values to the copy below (update if the current value differs).

| Loader | categoryKeys | Blurb | Key Features |
|---|---|---|---|
| **vanilla** | Vanilla, Java | The official Mojang server — pure Minecraft, no mods or plugins. | Official Mojang dedicated server · Most stable; day-one support for new versions · Datapacks & resource packs supported · No plugin or mod API |
| **bedrock** | Bedrock | The official Bedrock Dedicated Server for cross-platform play. | Cross-play across mobile, console & Windows · Official Mojang BDS binary · Add-ons + behavior / resource packs · Runs natively — no Java required |
| **paper** | Plugin server, Java | A high-performance Spigot fork with a huge plugin ecosystem. | High-performance Spigot / Bukkit fork · Full Bukkit / Spigot plugin API · Async chunk loading, anti-cheat & timings · Thousands of compatible plugins |
| **purpur** | Plugin server, Java | A drop-in Paper fork with hundreds of extra gameplay & config options. | Drop-in Paper fork — Paper plugins just work · Hundreds of extra config toggles · Fun gameplay tweaks (rideable mobs & more) · Performance-focused |
| **folia** | Plugin server, Java | A Paper fork using regionised multithreading for very large player counts. | Regionised multithreading — scales across CPU cores · Built for big, spread-out player bases · Paper-based · Needs Folia-compatible plugins |
| **fabric** | Mod loader, Java | A lightweight, fast-updating mod loader with a big community. | Lightweight; updates to new MC versions quickly · Pairs with Fabric API · Popular for client & server mods · Large, active modding community |
| **forge** | Mod loader, Java | The long-standing mod loader behind most large modpacks. | The original, most widely-supported mod loader · Powers most big modpacks · Extensive modding API · Best for content-heavy packs |
| **neoforge** | Mod loader, Java | A modern, community-driven fork of Forge. | Community-driven Forge fork · Modern, actively-developed API · Growing modpack adoption · Forge-like modding model |
| **quilt** | Mod loader, Java | A community fork of Fabric with extra features and tooling. | Fabric-compatible mod loader · Most Fabric mods run on Quilt · Extra hooks & the QSL library · Community-driven |

Feature i18n keys: name them `TXT_CODE_loader_feat_<loader>_1..4` (e.g. `TXT_CODE_loader_feat_paper_1`).

## Out of scope
- No hero banner for software (logos are small icons — keep the head icon).
- No live API data / no Java-version heuristic (Java note is the auto-provision message; chosen to be accurate for every version).
- Velocity/proxy support is a separate future task.

## Verification
1. `npm run type-check --prefix frontend` clean (LOADER_INFO type extended; all referenced keys exist).
2. `node -e "JSON.parse(...)"` on `en_US.json` valid.
3. Manual (Test stack): open each of the 9 software in the builder → Details tab shows the tags row, the Key Features list, and (all except Bedrock) the Java auto-provision note — comparable richness to the modpack detail. Bedrock shows no Java note.
