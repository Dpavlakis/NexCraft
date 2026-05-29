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
