# Custom Builder — Per-Loader Versions, Build Picker, Richer Details — Design

Date: 2026-05-30
Status: Approved (pending spec review)

## Goal

Make the Custom server builder show each loader's *real* available Minecraft
versions (live, like Bedrock), let the user pick the specific loader build for
modloaders, and replace the bare Details tab with loader logo + blurb + facts.

## Scope

In scope:
- Per-loader Minecraft version lists for Fabric / Forge / NeoForge / Quilt
  (Vanilla and Paper/Purpur/Folia/Bedrock already work).
- A loader-build picker in the install dialog for the four modloaders.
- A richer Details tab for custom builds (logo, blurb, facts, learn-more link).
- Server-side caching of the new version/build lists.

Out of scope:
- Build picker for Vanilla/Paper/Purpur/Folia/Bedrock (daemon auto-picks latest).
- Modpack (CurseForge/Modrinth/FTB) tabs — unchanged.
- The daemon loader-version *resolution* fix for the 26.x scheme (already shipped
  separately); this design supplies an explicit `loaderVersion`, which the daemon
  already prefers over its own resolution.

## Background (current state)

- Panel `modpack_router.ts` exposes `/minecraft_versions` (Mojang) and
  `/server_versions?software=` → `listServerVersions()` which handles
  `paper`/`folia` (PaperMC API), `purpur` (Purpur API), `bedrock` (Mojang links).
- Frontend `ModpackBrowser.vue` Custom tab: `SERVER_SOFTWARE =
  ["paper","purpur","folia","bedrock"]` use `/server_versions`; everything else
  (vanilla/fabric/forge/neoforge/quilt) uses the full Mojang list. That's why
  Fabric/Forge/NeoForge/Quilt offer versions a loader may not support.
- The install descriptor already carries `loaderVersion`; the daemon
  (`modloader_bootstrap.ts`) uses `this.input.loaderVersion` first, falling back
  to its own resolver only when empty.
- The Details tab for a custom build shows only `{version} · {type} · {date}`.

## Part 1 — Per-loader Minecraft version lists

Extend panel `listServerVersions(software)` to handle the four modloaders,
returning `{ id: mcVersion, type: "release" | "snapshot" }[]`, newest first:

- **fabric** → `GET https://meta.fabricmc.net/v2/versions/game` →
  `[{version, stable}]`; map `version` → `id`, `stable ? "release" : "snapshot"`.
- **quilt** → `GET https://meta.quiltmc.org/v3/versions/game` → same shape.
- **neoforge** → `GET https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge`
  → `versions[]` like `21.1.5` or `26.1.2.68-beta`. Derive the MC version per
  build and dedupe:
  - legacy `MAJOR.MINOR.PATCH` (e.g. `21.1.5`) → MC `1.MAJOR` + (`.MINOR` when
    `MINOR` ≠ 0) → `1.21.1`; `21.0.x` → `1.21`.
  - new scheme `26.1.2.NN[-beta]` → MC `26.1.2` (drop the trailing build).
  - mark MC versions whose only builds are pre-release as `type:"snapshot"`,
    else `"release"`.
- **forge** → `GET https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml`
  → `<version>MC-FORGE</version>` (e.g. `26.1.2-64.0.8`); take the `MC` prefix,
  dedupe, `type:"release"`.

Each list cached in-module for ~3h (mirror the existing Mojang/bedrock caches).

Frontend: change `SERVER_SOFTWARE` handling so Fabric/Forge/NeoForge/Quilt also
load via `/server_versions` (per-loader cache key = loader name); only `vanilla`
uses the Mojang list. The existing "Show snapshots" toggle still filters
non-release entries for these loaders.

## Part 2 — Loader build picker (modloaders only)

New panel endpoint `GET /protected_modpack/loader_versions?loader=&mc=` →
`{ id: loaderBuild, type: "release" | "snapshot" }[]`, newest first:

- **fabric** → `GET https://meta.fabricmc.net/v2/versions/loader/{mc}` →
  `[{loader:{version, ...}}]` → `id = loader.version`, all `"release"` (Fabric
  loader builds are MC-independent and stable).
- **quilt** → `GET https://meta.quiltmc.org/v3/versions/loader/{mc}` → same;
  builds containing `beta`/`rc` → `"snapshot"`.
- **neoforge** → builds from the neoforge versions API matching the MC's prefix
  (legacy `MAJOR.MINOR.` or new `{mc}.`); `beta/alpha/rc` → `"snapshot"`.
- **forge** → builds from `maven-metadata.xml` starting `"{mc}-"`, returning the
  trailing forge build; `"release"`.

Cached per `(loader, mc)` for ~3h.

Frontend (install dialog, Fabric/Forge/NeoForge/Quilt only): after the version
row, add a **Loader build** `a-select`, populated from `/loader_versions` when
the dialog opens. Default selection = newest `release`, else newest entry.
Send the chosen value as `loaderVersion` in the install/reinstall descriptor.
Vanilla/Paper/Purpur/Folia/Bedrock: no build picker; `loaderVersion` stays "".

API types: add `loaderVersionsGet` to `services/apis/modpack.ts`
(`{ params: { loader, mc } } → McVersion[]`).

## Part 3 — Richer Details tab

For custom builds, the Details tab renders (replacing the bare line):
- the **loader logo** (existing `LOADER_ICON` map) + loader display name,
- a short **blurb** from an in-app `LOADER_INFO` map,
- a **"Learn more"** link (official site) from the same map,
- **facts**: Minecraft version, release date, type, and — once chosen — the
  selected **loader build**.

`LOADER_INFO: Record<string, { blurb: string; url: string }>` lives in the
frontend (e.g. `tools/loaderInfo.ts`), covering vanilla, paper, purpur, folia,
fabric, forge, neoforge, quilt, bedrock. Blurb text added as i18n keys
(`TXT_CODE_loader_blurb_<loader>`) so it's translatable; the map holds keys +
urls. Modpack Details (CF/Modrinth/FTB) keep their existing HTML description.

## Part 4 — Fix Quilt server install + clear "no server build" errors (daemon)

`bootstrapFabricLike(kind)` in `modloader_bootstrap.ts` handles both Fabric and
Quilt by downloading a prebuilt launch jar from
`{meta}/versions/loader/{mc}/{loader}/{installer}/server/jar`. Fabric serves
this; Quilt's meta does not (→ 404). Quilt distributes servers via its
**installer**, like Forge/NeoForge.

- **Split Quilt into its own flow:** download the Quilt installer jar
  (`https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/{ver}/quilt-installer-{ver}.jar`,
  newest stable installer version), then spawn it (reusing the same
  `spawn`/print streaming the Forge/NeoForge installer path already uses):
  `java -jar quilt-installer.jar install server {mc} {loader} --install-dir=. --download-server`.
  Start command: `java -jar quilt-server-launch.jar nogui` (the installer emits
  this; fall back to `server.jar` detection if the name differs).
- **Fabric:** unchanged (keep the direct `/server/jar` download).
- **Clear errors:** wrap loader downloads/installs so a 404 (or missing artifact)
  surfaces a friendly message — new i18n key `TXT_CODE_modpack.noServerBuild`
  ("{loader} has no server build for Minecraft {mc} yet — try another version
  or loader.") — instead of a raw "Request failed with status code 404".

This is the one daemon change in this design; resolution of the explicit
`loaderVersion` from Parts 1–2 is already consumed by the daemon.

## Caching summary

- `/server_versions` per-loader lists: ~3h server cache (per loader).
- `/loader_versions` per `(loader, mc)`: ~3h server cache.
- Frontend keeps its existing per-source in-memory cache so switching loaders is
  instant after first load.

## Files touched

Panel:
- `app/routers/modpack_router.ts` — extend `listServerVersions`; add
  `/loader_versions` + a `listLoaderBuilds(loader, mc)` helper; add caches.

Frontend:
- `services/apis/modpack.ts` — add `loaderVersionsGet`.
- `tools/loaderInfo.ts` (new) — blurb-key + url per loader.
- `widgets/market/ModpackBrowser.vue` — per-loader version loading; loader-build
  dropdown in the install dialog; pass `loaderVersion`; richer custom Details.
- `languages/en_US.json` — `TXT_CODE_loader_blurb_*` + a "Loader build" label +
  "Learn more".

Daemon:
- `service/modloader_bootstrap.ts` — split Quilt off `bootstrapFabricLike` into
  an installer-based flow; wrap loader downloads to throw a clear
  "no server build" error on 404.
- `languages/en_US.json` — `TXT_CODE_modpack.noServerBuild`.

## Verification

1. Custom → Forge/NeoForge/Fabric/Quilt show only versions the loader supports
   (e.g. NeoForge lists `26.1.2`), and the list refreshes from upstream.
2. Selecting a modloader version shows a Loader build dropdown defaulting to the
   newest stable; Vanilla/Paper/etc. show no build dropdown.
3. Installing a modloader build sends that exact `loaderVersion`; the server
   installs and starts.
4. Details tab for a custom build shows logo + blurb + facts + learn-more link.
5. Switching loaders is instant after first load (caches); upstream APIs aren't
   hit on every switch.
6. Modpack (CF/Modrinth/FTB) tabs and their Details are unchanged.
7. Quilt installs via its installer and starts (no 404); a loader with genuinely
   no server build shows the clear "no server build" message, not a raw 404.
8. Builds green: daemon (webpack), panel (webpack), frontend (vue-tsc + vite).
