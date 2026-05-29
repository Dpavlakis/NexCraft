import { $t } from "../i18n";
import backupManager from "../service/backup_service";
import * as protocol from "../service/protocol";
import { routerApp } from "../service/router";
import { TaskCenter } from "../service/async_task_service/index";
import InstanceSubsystem from "../service/system_instance";

// Reject backup events targeting a non-existent instance
routerApp.use((event, ctx, data, next) => {
  if (event.startsWith("backup/")) {
    const instanceUuid = data?.instanceUuid;
    const instance = InstanceSubsystem.getInstance(instanceUuid);
    if (!instance) {
      return protocol.error(ctx, event, {
        instanceUuid,
        err: $t("TXT_CODE_backup.instanceNotExist")
      });
    }
  }
  next();
});

// Get the backup configuration for an instance
routerApp.on("backup/config_get", (ctx, data) => {
  try {
    protocol.response(ctx, backupManager.getConfig(data.instanceUuid));
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Update the backup configuration for an instance
routerApp.on("backup/config_set", (ctx, data) => {
  try {
    protocol.response(ctx, backupManager.setConfig(data.instanceUuid, data.config || {}));
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// List existing backups for an instance
routerApp.on("backup/list", (ctx, data) => {
  try {
    protocol.response(ctx, backupManager.list(data.instanceUuid));
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Start a new backup task
routerApp.on("backup/create", (ctx, data) => {
  try {
    const task = backupManager.startBackupTask(data.instanceUuid);
    protocol.response(ctx, { taskId: task.taskId });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Delete a backup
routerApp.on("backup/delete", (ctx, data) => {
  try {
    backupManager.delete(data.instanceUuid, data.fileName);
    protocol.response(ctx, true);
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Start a restore task from a backup file
routerApp.on("backup/restore", (ctx, data) => {
  try {
    const task = backupManager.startRestoreTask(data.instanceUuid, data.fileName);
    protocol.response(ctx, { taskId: task.taskId });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Poll the status/progress of a backup or restore task
routerApp.on("backup/task_status", (ctx, data) => {
  try {
    const task = TaskCenter.getTask(data.taskId);
    protocol.response(ctx, task ? task.toObject() : null);
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});
