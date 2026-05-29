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

const router = new Router({ prefix: "/protected_backup" });

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

// Get the backup configuration
router.get(
  "/config",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "backup/config_get",
        { instanceUuid }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Update the backup configuration
router.put(
  "/config",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const config = ctx.request.body;
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "backup/config_set",
        { instanceUuid, config }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// List existing backups
router.get(
  "/list",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "backup/list",
        { instanceUuid }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Start a backup
router.post(
  "/create",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      operationLogger.log("instance_backup_create", {
        operator_ip: ctx.ip,
        operator_name: ctx.session?.["userName"],
        instance_id: instanceUuid,
        daemon_id: daemonId
      });
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "backup/create",
        { instanceUuid }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Delete a backup
router.delete(
  "/",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String, file_name: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const fileName = String(ctx.query.file_name);
      operationLogger.log("instance_backup_delete", {
        operator_ip: ctx.ip,
        operator_name: ctx.session?.["userName"],
        instance_id: instanceUuid,
        daemon_id: daemonId,
        file: fileName
      });
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "backup/delete",
        { instanceUuid, fileName }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Restore a backup
router.post(
  "/restore",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String }, body: { file_name: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const fileName = String(ctx.request.body.file_name);
      operationLogger.log("instance_backup_restore", {
        operator_ip: ctx.ip,
        operator_name: ctx.session?.["userName"],
        instance_id: instanceUuid,
        daemon_id: daemonId,
        file: fileName
      });
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "backup/restore",
        { instanceUuid, fileName }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Poll a backup/restore task status
router.get(
  "/task_status",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String, task_id: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const taskId = String(ctx.query.task_id);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "backup/task_status",
        { instanceUuid, taskId }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Register a one-time passport to download a backup file directly from the daemon
router.post(
  "/download",
  permission({ level: ROLE.USER }),
  speedLimit(3),
  validator({ query: { uuid: String, daemonId: String, file_name: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const fileName = String(ctx.query.file_name);
      const remoteService = RemoteServiceSubsystem.getInstance(daemonId);
      if (!remoteService) throw new Error($t("TXT_CODE_dd559000") + ` Daemon ID: ${daemonId}`);
      const addr = remoteService.config.fullAddr;
      const remoteMappings = remoteService.config.getConvertedRemoteMappings();
      const password = timeUuid();
      await new RemoteRequest(remoteService).request("passport/register", {
        name: "backup-download",
        password: password,
        parameter: {
          fileName,
          instanceUuid
        }
      });
      operationLogger.log("instance_backup_download", {
        operator_ip: ctx.ip,
        operator_name: ctx.session?.["userName"],
        instance_id: instanceUuid,
        daemon_id: daemonId,
        file: fileName
      });
      ctx.body = {
        password,
        addr,
        remoteMappings
      };
    } catch (err) {
      ctx.body = err;
    }
  }
);

export default router;
