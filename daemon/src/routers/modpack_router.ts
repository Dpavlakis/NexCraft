import { $t } from "../i18n";
import { TaskCenter } from "../service/async_task_service/index";
import { ModpackInstallTask } from "../service/async_task_service/modpack_install_task";
import { ModpackUpdateTask } from "../service/async_task_service/modpack_update_task";
import * as protocol from "../service/protocol";
import { routerApp } from "../service/router";
import InstanceSubsystem from "../service/system_instance";

// Create a new instance and install a CurseForge/Modrinth modpack into it
routerApp.on("modpack/install", (ctx, data) => {
  try {
    const task = new ModpackInstallTask(String(data.instanceName), data.descriptor);
    TaskCenter.addTask(task);
    protocol.response(ctx, { taskId: task.taskId, instanceUuid: task.instance.instanceUuid });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Update an existing modpack instance to a new version
routerApp.on("modpack/update", (ctx, data) => {
  try {
    const instance = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!instance) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const task = new ModpackUpdateTask(instance, data.descriptor);
    TaskCenter.addTask(task);
    protocol.response(ctx, { taskId: task.taskId });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Poll a modpack install/update task
routerApp.on("modpack/task_status", (ctx, data) => {
  try {
    const task = TaskCenter.getTask(data.taskId);
    protocol.response(ctx, task ? task.toObject() : null);
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});
