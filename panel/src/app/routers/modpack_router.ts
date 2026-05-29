import Router from "@koa/router";
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
