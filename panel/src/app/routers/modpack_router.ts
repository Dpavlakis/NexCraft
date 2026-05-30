import Router from "@koa/router";
import axios from "axios";
import { ROLE } from "../entity/user";
import { $t } from "../i18n";
import { requestConcurrencyLimiter } from "../middleware/limit";
import permission from "../middleware/permission";
import validator from "../middleware/validator";
import { modManagerService } from "../service/mod_manager_service";
import { operationLogger } from "../service/operation_logger";
import RemoteRequest from "../service/remote_command";
import RemoteServiceSubsystem from "../service/remote_service";

const router = new Router({ prefix: "/protected_modpack" });

// Reset modes the daemon understands. An unknown value (typo / wrong case) must
// NOT silently fall through to a no-backup full wipe on the daemon, so clamp any
// unrecognised value to the safest option (always backs up first).
const RESET_MODES = ["backup_wipe", "wipe", "preserve_world"];
function normalizeResetMode(raw: unknown): string {
  const v = String(raw ?? "backup_wipe");
  return RESET_MODES.includes(v) ? v : "backup_wipe";
}

// List installable versions of a modpack (with CF server-pack availability flag)
router.get(
  "/versions",
  permission({ level: ROLE.USER }),
  requestConcurrencyLimiter("modpack:versions"),
  validator({ query: { source: String, projectId: String } }),
  async (ctx) => {
    try {
      const source = String(ctx.query.source).toLowerCase();
      const projectId = String(ctx.query.projectId);
      if (source === "curseforge") {
        ctx.body = await modManagerService.getCurseForgeModpackVersions(projectId);
      } else if (source === "ftb") {
        ctx.body = await modManagerService.getFTBModpackVersions(projectId);
      } else {
        ctx.body = await modManagerService.getProjectVersions(projectId, "modrinth");
      }
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Full project detail (description, screenshots, categories) for the dialog
router.get(
  "/detail",
  permission({ level: ROLE.USER }),
  requestConcurrencyLimiter("modpack:detail"),
  validator({ query: { source: String, projectId: String } }),
  async (ctx) => {
    try {
      ctx.body = await modManagerService.getModpackDetail(
        String(ctx.query.source),
        String(ctx.query.projectId)
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Resolve the install descriptor for a chosen modpack version.
async function buildDescriptor(body: any) {
  const source = String(body.source).toLowerCase();
  const packInfoBase = {
    source,
    projectId: String(body.projectId),
    projectName: String(body.projectName || ""),
    fileId: String(body.fileId),
    versionName: String(body.versionName || ""),
    iconUrl: body.iconUrl ? String(body.iconUrl) : undefined
  };

  if (source === "ftb") {
    // The daemon fetches the FTB version manifest itself (targets give mc+loader,
    // files give direct URLs), so we only pass the pack + version to resolve.
    return {
      source: "ftb",
      ftbPackId: Number(body.projectId),
      ftbVersionId: Number(body.fileId),
      maxMemoryMB: body.maxMemoryMB ? Number(body.maxMemoryMB) : undefined,
      packInfo: {
        ...packInfoBase,
        versionName: String(body.versionName || ""),
        mcVersion: "",
        loader: "",
        loaderVersion: ""
      }
    };
  }

  if (source === "curseforge") {
    const sp = await modManagerService.resolveCurseForgeServerPack(
      String(body.projectId),
      String(body.fileId)
    );
    if (!sp) {
      const e: any = new Error($t("TXT_CODE_modpack.noServerPack"));
      e.noServerPack = true;
      throw e;
    }
    return {
      source: "curseforge",
      serverPackUrl: sp.serverPackUrl,
      serverPackFileName: sp.fileName,
      mcVersion: sp.mcVersion,
      loader: sp.loader,
      loaderVersion: "",
      maxMemoryMB: body.maxMemoryMB ? Number(body.maxMemoryMB) : undefined,
      packInfo: {
        ...packInfoBase,
        mcVersion: sp.mcVersion,
        loader: sp.loader,
        loaderVersion: ""
      }
    };
  }

  // Modrinth
  const mr = await modManagerService.resolveModrinthVersion(String(body.fileId));
  if (!mr) throw new Error($t("TXT_CODE_modpack.noMrpack"));
  return {
    source: "modrinth",
    mrpackUrl: mr.mrpackUrl,
    mcVersion: mr.mcVersion,
    maxMemoryMB: body.maxMemoryMB ? Number(body.maxMemoryMB) : undefined,
    packInfo: {
      ...packInfoBase,
      versionName: body.versionName || mr.versionName,
      mcVersion: mr.mcVersion,
      loader: mr.loader || "",
      loaderVersion: ""
    }
  };
}

// Install a modpack as a new instance
router.post(
  "/install",
  permission({ level: ROLE.ADMIN }),
  validator({
    query: { daemonId: String },
    body: { source: String, projectId: String, fileId: String, instanceName: String }
  }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const body = ctx.request.body;
      const descriptor: any = await buildDescriptor(body);
      descriptor.acceptEula = !!body.acceptEula;
      operationLogger.log("instance_modpack_install", {
        operator_ip: ctx.ip,
        operator_name: ctx.session?.["userName"],
        daemon_id: daemonId,
        pack_name: String(body.projectName || body.projectId)
      });
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "modpack/install",
        { instanceName: String(body.instanceName), descriptor }
      );
    } catch (err: any) {
      ctx.body = err;
    }
  }
);

// Update an existing modpack instance to a new version
router.post(
  "/update",
  permission({ level: ROLE.ADMIN }),
  validator({
    query: { daemonId: String, uuid: String },
    body: { source: String, projectId: String, fileId: String }
  }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const descriptor = await buildDescriptor(ctx.request.body);
      operationLogger.log("instance_modpack_update", {
        operator_ip: ctx.ip,
        operator_name: ctx.session?.["userName"],
        instance_id: instanceUuid,
        daemon_id: daemonId,
        pack_name: String(ctx.request.body.projectName || ctx.request.body.projectId)
      });
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "modpack/update",
        { instanceUuid, descriptor }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Accurate Minecraft version list (Mojang manifest), cached for 6h.
let mcVersionsCache: { at: number; data: any[] } | null = null;
router.get("/minecraft_versions", permission({ level: ROLE.USER }), async (ctx) => {
  try {
    const now = Date.now();
    if (!mcVersionsCache || now - mcVersionsCache.at > 6 * 60 * 60 * 1000) {
      const res = await axios.get(
        "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
        { timeout: 20000 }
      );
      const versions = (res.data?.versions || []).map((v: any) => ({
        id: v.id,
        type: v.type,
        releaseTime: v.releaseTime
      }));
      mcVersionsCache = { at: now, data: versions };
    }
    ctx.body = mcVersionsCache.data;
  } catch (err) {
    ctx.body = err;
  }
});

// Server-software (Paper / Purpur / Folia) version lists from their official APIs.
const PAPER_API = "https://api.papermc.io/v2/projects";
const PURPUR_API = "https://api.purpurmc.org/v2/purpur";
const SERVER_SOFTWARE = ["paper", "purpur", "folia"];

// Bedrock Dedicated Server download links (Mojang exposes the current stable +
// preview builds via this JSON API). Cached for an hour.
const BEDROCK_LINKS_API =
  "https://net-secondary.web.minecraft-services.net/api/v1.0/download/links";
let bedrockCache: { at: number; stable?: { version: string; url: string }; preview?: { version: string; url: string } } | null = null;

async function getBedrockLinks() {
  const now = Date.now();
  if (bedrockCache && now - bedrockCache.at < 60 * 60 * 1000) return bedrockCache;
  const { data } = await axios.get(BEDROCK_LINKS_API, {
    timeout: 15000,
    headers: { "User-Agent": "Mozilla/5.0 (NexCraft)" }
  });
  const links: any[] = data?.result?.links || data?.links || [];
  const find = (type: string) => links.find((l) => l.downloadType === type)?.downloadUrl as string | undefined;
  const verOf = (url?: string) => url?.match(/bedrock-server-([\d.]+)\.zip/i)?.[1];
  const stableUrl = find("serverBedrockLinux");
  const previewUrl = find("serverBedrockPreviewLinux");
  bedrockCache = {
    at: now,
    stable: stableUrl ? { version: verOf(stableUrl) || "latest", url: stableUrl } : undefined,
    preview: previewUrl ? { version: verOf(previewUrl) || "preview", url: previewUrl } : undefined
  };
  return bedrockCache;
}

async function resolveBedrockUrl(version: string): Promise<string> {
  const links = await getBedrockLinks();
  if (links.preview && version === links.preview.version) return links.preview.url;
  return links.stable?.url || "";
}

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
  const re = /<version>([^<]+)<\/version>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const mc = m[1].split("-")[0];
    if (mc && !seen.has(mc)) {
      seen.add(mc);
      out.push({ id: mc, type: "release" });
    }
  }
  return out;
}

async function listServerVersions(software: string) {
  if (software === "bedrock") {
    const links = await getBedrockLinks();
    const out: any[] = [];
    if (links.stable) out.push({ id: links.stable.version, type: "release" });
    if (links.preview) out.push({ id: links.preview.version, type: "preview" });
    return out;
  }
  if (software === "paper" || software === "folia") {
    const { data } = await axios.get(`${PAPER_API}/${software}`, { timeout: 15000 });
    return (data?.versions || [])
      .slice()
      .reverse()
      .map((v: string) => ({ id: v, type: "release" }));
  }
  if (software === "purpur") {
    const { data } = await axios.get(PURPUR_API, { timeout: 15000 });
    return (data?.versions || [])
      .slice()
      .reverse()
      .map((v: string) => ({ id: v, type: "release" }));
  }
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
  return [];
}

async function resolveServerJarUrl(software: string, version: string): Promise<string> {
  if (software === "paper" || software === "folia") {
    const { data } = await axios.get(`${PAPER_API}/${software}/versions/${version}/builds`, {
      timeout: 15000
    });
    const builds = data?.builds || [];
    const last = builds[builds.length - 1];
    const name = last?.downloads?.application?.name;
    if (!last || !name) return "";
    return `${PAPER_API}/${software}/versions/${version}/builds/${last.build}/downloads/${name}`;
  }
  if (software === "purpur") {
    const { data } = await axios.get(`${PURPUR_API}/${version}`, { timeout: 15000 });
    const build = data?.builds?.latest;
    return build ? `${PURPUR_API}/${version}/${build}/download` : "";
  }
  return "";
}

router.get(
  "/server_versions",
  permission({ level: ROLE.USER }),
  validator({ query: { software: String } }),
  async (ctx) => {
    try {
      ctx.body = await listServerVersions(String(ctx.query.software).toLowerCase());
    } catch (err) {
      ctx.body = err;
    }
  }
);

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
    const xml = String(data);
    const re = /<version>([^<]+)<\/version>/g;
    let m: RegExpExecArray | null;
    const matches: string[] = [];
    while ((m = re.exec(xml)) !== null) matches.push(m[1]);
    out = matches
      .filter((v) => v.startsWith(`${mc}-`))
      .map((v) => v.slice(mc.length + 1))
      .reverse()
      .map((v) => ({ id: v, type: "release" }));
  }
  loaderBuildCache[cacheKey] = { at: Date.now(), data: out };
  return out;
}

router.get(
  "/loader_versions",
  permission({ level: ROLE.USER }),
  requestConcurrencyLimiter("modpack:loader_versions"),
  validator({ query: { loader: String, mc: String } }),
  async (ctx) => {
    try {
      const loader = String(ctx.query.loader).toLowerCase();
      const mc = String(ctx.query.mc);
      if (!/^[\w.\-]+$/.test(mc)) {
        ctx.body = [];
        return;
      }
      ctx.body = ["fabric", "quilt", "neoforge", "forge"].includes(loader)
        ? await listLoaderBuilds(loader, mc)
        : [];
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Build the install descriptor for a vanilla/loader/server-jar server build.
async function buildServerDescriptor(b: any) {
  const loader = String(b.loader || "vanilla").toLowerCase();
  const mcVersion = String(b.mcVersion);
  const packInfoBase = {
    projectId: `${loader}:${mcVersion}`,
    projectName: String(b.instanceName || loader),
    fileId: "",
    versionName: mcVersion,
    mcVersion,
    loader,
    loaderVersion: ""
  };
  if (loader === "bedrock") {
    const bedrockUrl = await resolveBedrockUrl(mcVersion);
    if (!bedrockUrl) throw new Error($t("TXT_CODE_modpack.noServerJar", { mc: mcVersion }));
    return {
      source: "bedrock",
      mcVersion,
      loader: "bedrock",
      bedrockUrl,
      maxMemoryMB: b.maxMemoryMB ? Number(b.maxMemoryMB) : undefined,
      acceptEula: !!b.acceptEula,
      packInfo: { ...packInfoBase, source: "bedrock" }
    };
  }
  if (SERVER_SOFTWARE.includes(loader)) {
    const serverJarUrl = await resolveServerJarUrl(loader, mcVersion);
    if (!serverJarUrl) throw new Error($t("TXT_CODE_modpack.noServerJar", { mc: mcVersion }));
    return {
      source: "serverjar",
      mcVersion,
      loader,
      serverJarUrl,
      maxMemoryMB: b.maxMemoryMB ? Number(b.maxMemoryMB) : undefined,
      acceptEula: !!b.acceptEula,
      packInfo: { ...packInfoBase, source: "serverjar" }
    };
  }
  return {
    source: "vanilla",
    mcVersion,
    loader,
    loaderVersion: "",
    maxMemoryMB: b.maxMemoryMB ? Number(b.maxMemoryMB) : undefined,
    acceptEula: !!b.acceptEula,
    packInfo: { ...packInfoBase, source: "vanilla" }
  };
}

// Build a fresh server for any Minecraft version: vanilla / a mod loader
// (daemon ModloaderBootstrap), or a server jar (Paper/Purpur/Folia).
router.post(
  "/install_server",
  permission({ level: ROLE.ADMIN }),
  validator({
    query: { daemonId: String },
    body: { mcVersion: String, loader: String, instanceName: String }
  }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const b = ctx.request.body;
      const descriptor = await buildServerDescriptor(b);
      operationLogger.log("instance_modpack_install", {
        operator_ip: ctx.ip,
        operator_name: ctx.session?.["userName"],
        daemon_id: daemonId,
        pack_name: `${descriptor.loader} ${descriptor.mcVersion}`
      });
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "modpack/install",
        { instanceName: String(b.instanceName), descriptor }
      );
    } catch (err: any) {
      ctx.body = err;
    }
  }
);

// Reinstall/reset an existing instance with a CurseForge/Modrinth modpack.
// resetMode: "backup_wipe" | "wipe" | "preserve_world".
router.post(
  "/reinstall",
  permission({ level: ROLE.ADMIN }),
  validator({
    query: { daemonId: String, uuid: String },
    body: { source: String, projectId: String, fileId: String }
  }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const descriptor: any = await buildDescriptor(ctx.request.body);
      descriptor.acceptEula = !!ctx.request.body.acceptEula;
      const resetMode = normalizeResetMode(ctx.request.body.resetMode);
      operationLogger.log("instance_modpack_install", {
        operator_ip: ctx.ip,
        operator_name: ctx.session?.["userName"],
        daemon_id: daemonId,
        pack_name: String(ctx.request.body.projectName || ctx.request.body.projectId)
      });
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "modpack/reinstall",
        { instanceUuid, descriptor, resetMode }
      );
    } catch (err: any) {
      ctx.body = err;
    }
  }
);

// Reinstall/reset an existing instance with a fresh vanilla/loader/server build.
router.post(
  "/reinstall_server",
  permission({ level: ROLE.ADMIN }),
  validator({
    query: { daemonId: String, uuid: String },
    body: { mcVersion: String, loader: String }
  }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const descriptor = await buildServerDescriptor(ctx.request.body);
      const resetMode = normalizeResetMode(ctx.request.body.resetMode);
      operationLogger.log("instance_modpack_install", {
        operator_ip: ctx.ip,
        operator_name: ctx.session?.["userName"],
        daemon_id: daemonId,
        pack_name: `${descriptor.loader} ${descriptor.mcVersion}`
      });
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "modpack/reinstall",
        { instanceUuid, descriptor, resetMode }
      );
    } catch (err: any) {
      ctx.body = err;
    }
  }
);

// Poll a modpack install/update task
router.get(
  "/task_status",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, task_id: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const taskId = String(ctx.query.task_id);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "modpack/task_status",
        { taskId }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

export default router;
