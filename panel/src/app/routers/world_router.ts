import Router from "@koa/router";
import { ROLE } from "../entity/user";
import { $t } from "../i18n";
import { speedLimit } from "../middleware/limit";
import permission from "../middleware/permission";
import validator from "../middleware/validator";
import { operationLogger } from "../service/operation_logger";
import { getUserUuid } from "../service/passport_service";
import { timeUuid } from "../service/password";
import { isHaveInstanceByUuid } from "../service/permission_service";
import RemoteRequest from "../service/remote_command";
import RemoteServiceSubsystem from "../service/remote_service";

const router = new Router({ prefix: "/protected_world" });

// Routing permission verification middleware: must own the target instance
router.use(async (ctx, next) => {
  const instanceUuid = String(ctx.query.uuid);
  const daemonId = String(ctx.query.daemonId);
  const userUuid = getUserUuid(ctx);
  if (isHaveInstanceByUuid(userUuid, daemonId, instanceUuid)) {
    await next();
  } else {
    ctx.status = 403;
    ctx.body = $t("TXT_CODE_permission.forbiddenInstance");
  }
});

// Active world info (admin)
router.get(
  "/info",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "world/info",
        { instanceUuid }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Prepare a world download: build the archive on the daemon, then register a
// one-time download passport. Returns { password, addr, remoteMappings, fileName }
// so the frontend can hit the shared /download/:key/:fileName route.
router.post(
  "/download",
  permission({ level: ROLE.ADMIN }),
  speedLimit(3),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const remoteService = RemoteServiceSubsystem.getInstance(daemonId);
      if (!remoteService) throw new Error($t("TXT_CODE_dd559000") + ` Daemon ID: ${daemonId}`);
      const prepared = await new RemoteRequest(remoteService).request<{
        fileName: string;
        relPath: string;
      }>("world/prepare_download", { instanceUuid });
      const addr = remoteService.config.fullAddr;
      const remoteMappings = remoteService.config.getConvertedRemoteMappings();
      const password = timeUuid();
      await new RemoteRequest(remoteService).request("passport/register", {
        name: "download",
        password,
        parameter: { fileName: prepared.relPath, instanceUuid }
      });
      ctx.body = { password, addr, remoteMappings, fileName: prepared.fileName };
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Replace the active world from an uploaded archive (admin)
router.post(
  "/replace",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String, uuid: String }, body: { fileName: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const fileName = String(ctx.request.body.fileName);
      operationLogger.log("instance_world_replace", {
        operator_ip: ctx.ip,
        operator_name: ctx.session?.["userName"],
        instance_id: instanceUuid,
        daemon_id: daemonId
      });
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "world/replace",
        { instanceUuid, fileName }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Reset the active world (admin)
router.post(
  "/reset",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      operationLogger.log("instance_world_reset", {
        operator_ip: ctx.ip,
        operator_name: ctx.session?.["userName"],
        instance_id: instanceUuid,
        daemon_id: daemonId
      });
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "world/reset",
        { instanceUuid }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Back up the active world (admin) — non-destructive, no operation log.
router.post(
  "/backup",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "world/backup",
        { instanceUuid }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Poll a world task (admin)
router.get(
  "/task_status",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String, uuid: String, task_id: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const taskId = String(ctx.query.task_id);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "world/task_status",
        { taskId }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

export default router;
