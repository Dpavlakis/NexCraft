# Custom Builder — Versions, Build Picker, Details, Quilt Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Custom builder show each loader's real available Minecraft versions, let the user pick the loader build for modloaders, give custom builds a richer Details tab, and fix Quilt server installs.

**Architecture:** Panel gains per-loader version + build endpoints (live, cached) from each loader's official API; the frontend Custom tab consumes them per-loader and adds a build dropdown; the install dialog Details tab gets a loader logo/blurb/facts block; the daemon installs Quilt via its installer instead of Fabric's server-jar URL and reports a clear error when a loader has no server build.

**Tech Stack:** Koa + TypeScript (panel, daemon, webpack), Vue 3 + Ant Design Vue 4 + vue-i18n (frontend, vue-tsc + vite).

**Verification methodology:** This project uses build + type-check as the gate (no unit-test runner). Each task ends by building the affected package(s) and committing. Run from `D:\NexCraft` with the Node PATH prefix.

PATH prefix for every PowerShell command:
```
$env:Path = "C:\Program Files\nodejs;" + [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User"); Set-Location D:\NexCraft;
```
Builds: `npm run build --prefix daemon` · `npm run build --prefix panel` · `npm run type-check --prefix frontend` · `npm run build --prefix frontend`.

---

## File Structure

Panel:
- `app/routers/modpack_router.ts` — extend `listServerVersions`; add modloader MC-version derivation helpers; add `/loader_versions` + `listLoaderBuilds`; add caches.

Frontend:
- `services/apis/modpack.ts` — add `loaderVersionsGet`.
- `tools/loaderInfo.ts` (new) — per-loader `{ blurbKey, url }`.
- `widgets/market/ModpackBrowser.vue` — per-loader version loading; loader-build dropdown; pass `loaderVersion`; custom Details block.
- `languages/en_US.json` — blurb keys + labels.

Daemon:
- `service/modloader_bootstrap.ts` — Quilt installer flow; clear no-server-build error.
- `languages/en_US.json` — `TXT_CODE_modpack.noServerBuild`.

---

## Task 1: Panel — per-loader Minecraft version lists

**Files:** Modify `panel/src/app/routers/modpack_router.ts`

- [ ] **Step 1: Add modloader version sources + caching to `listServerVersions`**

Just above the existing `async function listServerVersions(software: string)` (around line 260), add helpers and a cache:

```ts
// Per-loader Minecraft version lists, cached ~3h to avoid hammering upstream.
const loaderMcCache: Record<string, { at: number; data: any[] }> = {};
const LOADER_MC_TTL = 3 * 60 * 60 * 1000;

// NeoForge build version -> Minecraft version. Two schemes coexist:
//   legacy "21.1.5" (3 parts) -> MC "1.21.1" (or "1.21" when patch is 0)
//   new    "26.1.2.68-beta"   (4 parts) -> MC "26.1.2"
function neoforgeBuildToMc(build: string): string {
  const nums = build.split("-")[0].split(".");
  if (nums.length >= 4) return `${nums[0]}.${nums[1]}.${nums[2]}`;
  const minor = nums[0];
  const patch = nums[1];
  return patch && patch !== "0" ? `1.${minor}.${patch}` : `1.${minor}`;
}

async function fetchFabricLikeGameVersions(url: string) {
  const { data } = await axios.get(url, { timeout: 15000 });
  return (Array.isArray(data) ? data : [])
    .map((g: any) => ({ id: String(g.version), type: g.stable ? "release" : "snapshot" }));
}

async function fetchNeoforgeMcVersions() {
  const { data } = await axios.get(
    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
    { timeout: 15000 }
  );
  const versions: string[] = data?.versions || [];
  const byMc = new Map<string, boolean>(); // mc -> hasStable
  for (const v of versions) {
    const mc = neoforgeBuildToMc(v);
    const stable = !/beta|alpha|rc/i.test(v);
    byMc.set(mc, (byMc.get(mc) || false) || stable);
  }
  return [...byMc.entries()].map(([id, hasStable]) => ({
    id,
    type: hasStable ? "release" : "snapshot"
  }));
}

async function fetchForgeMcVersions() {
  const { data } = await axios.get(
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
    { timeout: 20000, responseType: "text" }
  );
  const xml = String(data);
  const seen = new Set<string>();
  const out: any[] = [];
  for (const m of xml.matchAll(/<version>([^<]+)<\/version>/g)) {
    const mc = m[1].split("-")[0];
    if (mc && !seen.has(mc)) {
      seen.add(mc);
      out.push({ id: mc, type: "release" });
    }
  }
  return out;
}
```

- [ ] **Step 2: Wire those into `listServerVersions` (newest-first, cached)**

Inside `listServerVersions`, before the final `return [];`, add the modloader branch (the existing paper/folia/purpur/bedrock branches stay):

```ts
  if (["fabric", "quilt", "neoforge", "forge"].includes(software)) {
    const cached = loaderMcCache[software];
    if (cached && Date.now() - cached.at < LOADER_MC_TTL) return cached.data;
    let data: any[] = [];
    if (software === "fabric") {
      data = await fetchFabricLikeGameVersions("https://meta.fabricmc.net/v2/versions/game");
    } else if (software === "quilt") {
      data = await fetchFabricLikeGameVersions("https://meta.quiltmc.org/v3/versions/game");
    } else if (software === "neoforge") {
      data = (await fetchNeoforgeMcVersions()).reverse();
    } else if (software === "forge") {
      data = (await fetchForgeMcVersions()).reverse();
    }
    loaderMcCache[software] = { at: Date.now(), data };
    return data;
  }
```

(`axios` is already imported in this file — confirm; it's used by the existing bedrock/paper fetches.)

- [ ] **Step 3: Build the panel**

Run: `npm run build --prefix panel` → expect `compiled successfully`.

- [ ] **Step 4: Commit**

```
git add panel/src/app/routers/modpack_router.ts; git commit -m "feat(custom): per-loader Minecraft version lists for fabric/forge/neoforge/quilt" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Frontend — load per-loader versions in the Custom tab

**Files:** Modify `frontend/src/widgets/market/ModpackBrowser.vue`

- [ ] **Step 1: Treat the four modloaders as per-loader version sources**

Find:
```ts
// Paper/Purpur/Folia/Bedrock have their own version lists; the rest use Mojang's.
const SERVER_SOFTWARE = ["paper", "purpur", "folia", "bedrock"];
const isServerSoftware = (l: string) => SERVER_SOFTWARE.includes(l);
```
Replace with:
```ts
// Every loader except plain Vanilla has its own curated version list (server
// software APIs, or each loader's game-version API). Vanilla uses Mojang's list.
const PER_LOADER_VERSIONS = [
  "paper",
  "purpur",
  "folia",
  "bedrock",
  "fabric",
  "quilt",
  "forge",
  "neoforge"
];
const isServerSoftware = (l: string) => PER_LOADER_VERSIONS.includes(l);
```

`loadCustom` already does `const key = isServerSoftware(customLoader.value) ? customLoader.value : "mojang"` and calls `serverVersionsGet({ params: { software: customLoader.value } })` for the non-mojang key — so the four modloaders now route to `/server_versions` automatically. No other change needed there.

- [ ] **Step 2: Type-check + build**

Run: `npm run type-check --prefix frontend` then `npm run build --prefix frontend`. Expect clean + `✓ built`.

- [ ] **Step 3: Commit**

```
git add frontend/src/widgets/market/ModpackBrowser.vue; git commit -m "feat(custom): fetch per-loader version lists for modloaders" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Panel — loader build list endpoint

**Files:** Modify `panel/src/app/routers/modpack_router.ts`

- [ ] **Step 1: Add `listLoaderBuilds(loader, mc)` + cache**

Add near the version helpers from Task 1:

```ts
const loaderBuildCache: Record<string, { at: number; data: any[] }> = {};

async function fetchFabricLikeLoaderBuilds(meta: string, mc: string) {
  const { data } = await axios.get(`${meta}/versions/loader/${mc}`, { timeout: 15000 });
  return (Array.isArray(data) ? data : []).map((e: any) => {
    const v = String(e?.loader?.version ?? "");
    return { id: v, type: /beta|alpha|rc/i.test(v) ? "snapshot" : "release" };
  });
}

async function listLoaderBuilds(loader: string, mc: string) {
  const cacheKey = `${loader}:${mc}`;
  const cached = loaderBuildCache[cacheKey];
  if (cached && Date.now() - cached.at < LOADER_MC_TTL) return cached.data;

  let out: any[] = [];
  if (loader === "fabric") {
    out = await fetchFabricLikeLoaderBuilds("https://meta.fabricmc.net/v2", mc);
  } else if (loader === "quilt") {
    out = await fetchFabricLikeLoaderBuilds("https://meta.quiltmc.org/v3", mc);
  } else if (loader === "neoforge") {
    const { data } = await axios.get(
      "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
      { timeout: 15000 }
    );
    const versions: string[] = data?.versions || [];
    out = versions
      .filter((v) => neoforgeBuildToMc(v) === mc)
      .reverse()
      .map((v) => ({ id: v, type: /beta|alpha|rc/i.test(v) ? "snapshot" : "release" }));
  } else if (loader === "forge") {
    const { data } = await axios.get(
      "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
      { timeout: 20000, responseType: "text" }
    );
    out = [...String(data).matchAll(/<version>([^<]+)<\/version>/g)]
      .map((m) => m[1])
      .filter((v) => v.startsWith(`${mc}-`))
      .map((v) => v.slice(mc.length + 1))
      .reverse()
      .map((v) => ({ id: v, type: "release" }));
  }
  loaderBuildCache[cacheKey] = { at: Date.now(), data: out };
  return out;
}
```

- [ ] **Step 2: Add the route**

After the existing `router.get("/server_versions", ...)` handler, add:

```ts
router.get(
  "/loader_versions",
  permission({ level: ROLE.USER }),
  validator({ query: { loader: String, mc: String } }),
  async (ctx) => {
    try {
      const loader = String(ctx.query.loader).toLowerCase();
      const mc = String(ctx.query.mc);
      ctx.body = ["fabric", "quilt", "neoforge", "forge"].includes(loader)
        ? await listLoaderBuilds(loader, mc)
        : [];
    } catch (err) {
      ctx.body = err;
    }
  }
);
```

- [ ] **Step 3: Build the panel**

Run: `npm run build --prefix panel` → expect `compiled successfully`.

- [ ] **Step 4: Commit**

```
git add panel/src/app/routers/modpack_router.ts; git commit -m "feat(custom): /loader_versions endpoint listing builds per loader+mc" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — loader build picker in the install dialog

**Files:** Modify `frontend/src/services/apis/modpack.ts`, `frontend/src/widgets/market/ModpackBrowser.vue`, `languages/en_US.json`

- [ ] **Step 1: Add the API**

In `frontend/src/services/apis/modpack.ts`, after `serverVersionsGet`, append:

```ts
// Loader build versions for a given loader + Minecraft version (modloaders only)
export const loaderVersionsGet = useDefineApi<
  { params: { loader: string; mc: string } },
  McVersion[]
>({
  url: "/api/protected_modpack/loader_versions",
  method: "GET"
});
```

- [ ] **Step 2: i18n label**

In `languages/en_US.json` add (next to other modpack keys):

```json
  "TXT_CODE_modpack_loader_build": "Loader build",
```

- [ ] **Step 3: Dialog state + loading in `ModpackBrowser.vue`**

Add `loaderVersionsGet` to the existing `@/services/apis/modpack` import.

Add to the `dialog` reactive (after `selectedVersion`):
```ts
  loaderVersions: [] as McVersion[],
  loaderVersionLoading: false,
  selectedLoaderVersion: "" as string,
```

Add a helper + a watcher (near `openInstall`):
```ts
// Modloaders let the user choose the specific build; others auto-pick latest.
const MODLOADERS = ["fabric", "quilt", "forge", "neoforge"];
const needsLoaderBuild = computed(
  () => source.value === "custom" && MODLOADERS.includes(customLoader.value)
);

const loadLoaderBuilds = async (mc: string) => {
  dialog.loaderVersions = [];
  dialog.selectedLoaderVersion = "";
  if (!needsLoaderBuild.value || !mc) return;
  dialog.loaderVersionLoading = true;
  try {
    const res = await loaderVersionsGet().execute({
      params: { loader: customLoader.value, mc }
    });
    dialog.loaderVersions = res.value || [];
    const stable = dialog.loaderVersions.find((v) => v.type === "release");
    dialog.selectedLoaderVersion = (stable || dialog.loaderVersions[0])?.id || "";
  } catch (err: any) {
    reportErrorMsg(err.message);
  } finally {
    dialog.loaderVersionLoading = false;
  }
};
```

In `openInstall`, inside the `if (source.value === "custom") { ... }` branch (after setting `instanceName`), add:
```ts
    loadLoaderBuilds(item.id);
```

- [ ] **Step 4: Send the chosen build as `loaderVersion`**

In `doInstall`, the custom branches build a `data` object with `mcVersion`, `loader`, etc. Add `loaderVersion: dialog.selectedLoaderVersion` to BOTH custom branches (the `installServer` call and the `reinstallServer` call). Example (installServer branch):
```ts
          data: {
            mcVersion: dialog.item.id,
            loader: customLoader.value,
            loaderVersion: dialog.selectedLoaderVersion,
            maxMemoryMB: dialog.maxMemoryMB,
            acceptEula: dialog.acceptEula,
            ...
          }
```
(If `installServer`/`reinstallServer`'s API type doesn't include `loaderVersion`, add `loaderVersion?: string` to their `data` types in `services/apis/modpack.ts`. The panel `buildServerDescriptor` already reads `b.loaderVersion` into `packInfoBase.loaderVersion` — verify; if it currently hardcodes `loaderVersion: ""`, change it to `String(b.loaderVersion || "")`.)

- [ ] **Step 5: Build dropdown in the Install tab**

In the install form, right after the custom version `<a-form-item v-if="source === 'custom'">` (the disabled version display), add:
```vue
      <a-form-item v-if="needsLoaderBuild" :label="t('TXT_CODE_modpack_loader_build')">
        <a-select
          v-model:value="dialog.selectedLoaderVersion"
          :loading="dialog.loaderVersionLoading"
          :placeholder="t('TXT_CODE_modpack_loader_build')"
        >
          <a-select-option v-for="lv in dialog.loaderVersions" :key="lv.id" :value="lv.id">
            {{ lv.id }}{{ lv.type === "snapshot" ? " (beta)" : "" }}
          </a-select-option>
        </a-select>
      </a-form-item>
```

Update `canInstall` so modloader custom installs require a chosen build:
```ts
  if (source.value === "custom") {
    if (needsLoaderBuild.value && !dialog.selectedLoaderVersion) return false;
    return !!dialog.item?.id && dialog.acceptEula;
  }
```

- [ ] **Step 6: Type-check + build**

Run: `npm run type-check --prefix frontend` then `npm run build --prefix frontend`. Expect clean + `✓ built`.

- [ ] **Step 7: Commit**

```
git add frontend/src/services/apis/modpack.ts frontend/src/widgets/market/ModpackBrowser.vue languages/en_US.json; git commit -m "feat(custom): loader build picker for modloaders" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — richer custom Details tab

**Files:** Create `frontend/src/tools/loaderInfo.ts`; modify `frontend/src/widgets/market/ModpackBrowser.vue`, `languages/en_US.json`

- [ ] **Step 1: i18n blurbs + labels**

In `languages/en_US.json` add:
```json
  "TXT_CODE_loader_learn_more": "Learn more",
  "TXT_CODE_loader_blurb_vanilla": "The official Mojang server. No mods or plugins — pure Minecraft.",
  "TXT_CODE_loader_blurb_paper": "High-performance Spigot fork with broad plugin support and great optimisations.",
  "TXT_CODE_loader_blurb_purpur": "A Paper fork adding extensive gameplay and config customisation.",
  "TXT_CODE_loader_blurb_folia": "A Paper fork using regionised multithreading for very large player counts.",
  "TXT_CODE_loader_blurb_fabric": "Lightweight, fast-updating mod loader popular for performance and tech mods.",
  "TXT_CODE_loader_blurb_forge": "The long-standing mod loader behind most large modpacks.",
  "TXT_CODE_loader_blurb_neoforge": "A modern community-driven fork of Forge.",
  "TXT_CODE_loader_blurb_quilt": "A Fabric-compatible mod loader focused on modularity.",
  "TXT_CODE_loader_blurb_bedrock": "The official Bedrock Dedicated Server for cross-platform play.",
```

- [ ] **Step 2: Create `frontend/src/tools/loaderInfo.ts`**

```ts
// Per-loader description (i18n key) + official link for the custom Details tab.
export const LOADER_INFO: Record<string, { blurbKey: string; url: string }> = {
  vanilla: { blurbKey: "TXT_CODE_loader_blurb_vanilla", url: "https://www.minecraft.net/" },
  paper: { blurbKey: "TXT_CODE_loader_blurb_paper", url: "https://papermc.io/software/paper" },
  purpur: { blurbKey: "TXT_CODE_loader_blurb_purpur", url: "https://purpurmc.org/" },
  folia: { blurbKey: "TXT_CODE_loader_blurb_folia", url: "https://papermc.io/software/folia" },
  fabric: { blurbKey: "TXT_CODE_loader_blurb_fabric", url: "https://fabricmc.net/" },
  forge: { blurbKey: "TXT_CODE_loader_blurb_forge", url: "https://forums.minecraftforge.net/" },
  neoforge: { blurbKey: "TXT_CODE_loader_blurb_neoforge", url: "https://neoforged.net/" },
  quilt: { blurbKey: "TXT_CODE_loader_blurb_quilt", url: "https://quiltmc.org/" },
  bedrock: { blurbKey: "TXT_CODE_loader_blurb_bedrock", url: "https://www.minecraft.net/download/server/bedrock" }
};
```

- [ ] **Step 3: Render the custom Details block**

In `ModpackBrowser.vue` script, import it and add a computed:
```ts
import { LOADER_INFO } from "@/tools/loaderInfo";

const currentLoaderInfo = computed(() => LOADER_INFO[customLoader.value]);
```

In the Details tab (`<a-tab-pane key="details">`), wrap the existing modpack `<div v-if="dialog.item" class="pack-detail">` with a custom branch BEFORE it:
```vue
        <div v-if="dialog.item && source === 'custom'" class="pack-detail custom-detail">
          <div class="pack-head">
            <img v-if="loaderIcon" :src="loaderIcon" class="loader-detail-icon" alt="" />
            <div class="pack-head-text">
              <div class="pack-title">{{ currentLoaderLabel() }} {{ dialog.item.id }}</div>
              <div class="pack-meta">
                <span>{{ dialog.item.description }}</span>
                <span v-if="dialog.selectedLoaderVersion"> · {{ dialog.selectedLoaderVersion }}</span>
              </div>
              <a
                v-if="currentLoaderInfo"
                :href="currentLoaderInfo.url"
                target="_blank"
                rel="noopener"
              >
                {{ t("TXT_CODE_loader_learn_more") }}
              </a>
            </div>
          </div>
          <p v-if="currentLoaderInfo" class="pack-desc">{{ t(currentLoaderInfo.blurbKey) }}</p>
        </div>
        <div v-else-if="dialog.item" class="pack-detail">
```
(The closing `</div>` of the existing pack-detail block stays; you only added the custom branch and changed the modpack block's `v-if` to `v-else-if`.)

Add CSS in the component `<style>`:
```scss
.custom-detail .loader-detail-icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
  margin-right: 12px;
}
.custom-detail .pack-head {
  display: flex;
  align-items: center;
}
```

- [ ] **Step 4: Type-check + build**

Run: `npm run type-check --prefix frontend` then `npm run build --prefix frontend`. Expect clean + `✓ built`.

- [ ] **Step 5: Commit**

```
git add frontend/src/tools/loaderInfo.ts frontend/src/widgets/market/ModpackBrowser.vue languages/en_US.json; git commit -m "feat(custom): richer Details tab with loader logo, blurb, and link" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Daemon — Quilt installer flow + clear no-server-build error

**Files:** Modify `daemon/src/service/modloader_bootstrap.ts`, `languages/en_US.json`

- [ ] **Step 1: i18n key**

In `languages/en_US.json` add:
```json
  "TXT_CODE_modpack.noServerBuild": "{{loader}} has no server build for Minecraft {{mc}} yet — try another version or loader.",
```

- [ ] **Step 2: Add a Quilt-specific bootstrap and route Quilt to it**

In `daemon/src/service/modloader_bootstrap.ts`, change `bootstrapFabricLike` to only handle Fabric, and add a `bootstrapQuilt`. Find the dispatch in `run()`'s switch (the `case "fabric": case "quilt":` that calls `bootstrapFabricLike(this.input.loader)`) and split it:
```ts
      case "fabric":
        result = await this.bootstrapFabricLike("fabric");
        break;
      case "quilt":
        result = await this.bootstrapQuilt();
        break;
```
(Locate the existing `switch (this.input.loader)` — currently fabric and quilt share a case. If they share `case "fabric": case "quilt": result = await this.bootstrapFabricLike(this.input.loader);`, replace with the two cases above.)

Change the `bootstrapFabricLike` signature to `private async bootstrapFabricLike(kind: "fabric"): Promise<IBootstrapResult>` (it no longer takes quilt; the `meta`/`launchJar` ternaries can be simplified to the fabric values, but leaving them is harmless — minimal change: keep the body, it still works for `"fabric"`).

Add the new method after `bootstrapFabricLike`:
```ts
  private async bootstrapQuilt(): Promise<IBootstrapResult> {
    const cwd = this.cwd();
    const mc = this.input.mcVersion;
    const loaderVer = this.input.loaderVersion || (await this.resolveLoaderVersion());
    if (!loaderVer) throw new Error($t("TXT_CODE_modpack.unknownLoaderVersion"));

    // Quilt ships a generic installer jar (no prebuilt server-jar endpoint).
    const installers = await this.fetchJson<any[]>("https://meta.quiltmc.org/v3/versions/installer");
    const installerVer = (installers.find((i: any) => i.stable) || installers[0])?.version;
    if (!installerVer) throw new Error($t("TXT_CODE_modpack.noLoader", { loader: "quilt" }));
    const installerUrl =
      `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/` +
      `${installerVer}/quilt-installer-${installerVer}.jar`;
    const installerPath = path.join(cwd, "quilt-installer.jar");

    this.println($t("TXT_CODE_modpack.fetchLoader", { loader: "quilt", version: loaderVer }));
    try {
      await downloadManager.downloadFromUrl(installerUrl, installerPath);
    } catch {
      throw new Error($t("TXT_CODE_modpack.noServerBuild", { loader: "Quilt", mc }));
    }

    this.println($t("TXT_CODE_modpack.runInstaller"));
    await this.runJar(this.installerJava, "quilt-installer.jar", [
      "install",
      "server",
      mc,
      loaderVer,
      "--install-dir=.",
      "--download-server"
    ]);

    for (const f of ["quilt-installer.jar"]) {
      try {
        await fs.remove(path.join(cwd, f));
      } catch {
        // ignore
      }
    }

    // The installer emits quilt-server-launch.jar; fall back to a detected start.
    const launchJar = path.join(cwd, "quilt-server-launch.jar");
    if (fs.existsSync(launchJar)) {
      return { startCommand: `${this.startJava} ${this.memArgs()} -jar quilt-server-launch.jar nogui` };
    }
    const start = this.detectStartFromExisting(false);
    if (!start) throw new Error($t("TXT_CODE_modpack.noServerBuild", { loader: "Quilt", mc }));
    return { startCommand: start };
  }
```

(`fs`, `path`, `downloadManager`, `runJar`, `detectStartFromExisting`, `memArgs`, `startJava`, `installerJava`, `resolveLoaderVersion`, `fetchJson` are all already used in this file.)

- [ ] **Step 3: Clear error if Fabric's server-jar 404s too**

In `bootstrapFabricLike`, wrap the launch-jar download so a 404 is friendly. Find:
```ts
    await downloadManager.downloadFromUrl(jarUrl, path.join(cwd, launchJar));
```
Replace with:
```ts
    try {
      await downloadManager.downloadFromUrl(jarUrl, path.join(cwd, launchJar));
    } catch {
      throw new Error($t("TXT_CODE_modpack.noServerBuild", { loader: "Fabric", mc }));
    }
```

- [ ] **Step 4: Build daemon + panel**

Run: `npm run build --prefix daemon` then `npm run build --prefix panel`. Expect both `compiled successfully`.

- [ ] **Step 5: Commit**

```
git add daemon/src/service/modloader_bootstrap.ts languages/en_US.json; git commit -m "fix(quilt): install via the Quilt installer; clear error when no server build exists" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Final verification + push

- [ ] **Step 1: Build everything**

Run:
```
npm run build --prefix daemon; npm run build --prefix panel; npm run type-check --prefix frontend; npm run build --prefix frontend
```
Expected: all succeed.

- [ ] **Step 2: Push**

```
git push nexcraft main
```

- [ ] **Step 3: Manual verification (after rebuilding + updating both images)**

1. Custom → Fabric/Forge/NeoForge/Quilt show only versions the loader supports; lists refresh from upstream.
2. Picking a modloader version shows a "Loader build" dropdown defaulting to newest stable; Vanilla/Paper/Purpur/Folia/Bedrock show no build dropdown.
3. Installing a modloader build sends that exact build; the server installs and starts.
4. Details tab for a custom build shows loader logo + blurb + facts + "Learn more".
5. Quilt installs (no 404) and starts; a loader with genuinely no server build shows the "no server build" message.
6. Modpack (CF/Modrinth/FTB) tabs + Details unchanged.

---

## Self-Review Notes

- **Spec coverage:** Part 1 → Tasks 1–2; Part 2 → Tasks 3–4; Part 3 → Task 5; Part 4 → Task 6. Caching: Tasks 1 & 3. All spec parts covered.
- **Type consistency:** `listServerVersions`/`listLoaderBuilds`/`neoforgeBuildToMc` (panel) used consistently; `loaderVersionsGet` returns `McVersion[]` matching the build dropdown; `needsLoaderBuild`/`dialog.selectedLoaderVersion`/`loadLoaderBuilds` consistent across Task 4; `LOADER_INFO`/`currentLoaderInfo`/`blurbKey` consistent in Task 5; `bootstrapQuilt`/`TXT_CODE_modpack.noServerBuild` consistent in Task 6.
- **No placeholders:** every code step shows the actual code.
- **Verification note:** the daemon already prefers `this.input.loaderVersion`, so the build picker's value flows through without a daemon change beyond Quilt's install method.
