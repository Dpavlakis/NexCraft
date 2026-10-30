import { acquireInstanceOperation } from "../service/instance_operation_lock";
import { assertSafePath } from "../utils/safe_path";
import { v4 } from "uuid";
import fs from "fs-extra";
import path from "path";
import { $t } from "../i18n";
import * as protocol from "../service/protocol";
import { routerApp } from "../service/router";
import FileManager from "../service/system_file";
import InstanceSubsystem from "../service/system_instance";
import { TaskCenter } from "../service/async_task_service";
import { WorldReplaceTask } from "../service/async_task_service/world_replace_task";
import { WorldResetTask } from "../service/async_task_service/world_reset_task";
import { WorldBackupTask } from "../service/async_task_service/world_backup_task";
import { readLevelName } from "../service/modpack_files";
import {
  WORLD_DOWNLOAD_DIR,
  getWorldInfo,
  getWorldKind,
  worldDownloadFileName,
  zipWorld
} from "../service/world_service";

// Read-only info about the active world.
routerApp.on("world/info", async (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    protocol.response(ctx, await getWorldInfo(inst));
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Build a downloadable world archive into a temp dir under cwd. Returns the
// relative path (served by the shared /download/:key/:fileName route) plus the
// browser-suggested filename. Read-only: no stop, no backup.
routerApp.on("world/prepare_download", async (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const release = acquireInstanceOperation(inst.instanceUuid);
    try {
      const cwd = inst.absoluteCwdPath();
      const kind = getWorldKind(inst);
      const levelName = readLevelName(cwd);
      const fileName = worldDownloadFileName(kind, levelName);
      const downloadRoot = assertSafePath(cwd, path.join(cwd, WORLD_DOWNLOAD_DIR));
      await fs.remove(downloadRoot);
      const relativeDir = path.posix.join(WORLD_DOWNLOAD_DIR, v4());
      const dlDir = assertSafePath(cwd, path.join(cwd, relativeDir));
      try {
        await fs.ensureDir(dlDir);
        await zipWorld(cwd, kind, levelName, path.join(dlDir, fileName));
      } catch (error) {
        try { await fs.remove(dlDir); } catch { /* Preserve the prepare failure. */ }
        throw error;
      }
      protocol.response(ctx, {
        fileName,
        relPath: path.posix.join(relativeDir, fileName)
      });
    } finally { release(); }
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Replace the active world from an already-uploaded archive in WORLD_UPLOAD_DIR.
routerApp.on("world/replace", (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const hint = String(data.fileName || "");
    if (hint && !FileManager.checkFileName(path.basename(hint)))
      throw new Error("Access denied: Malformed file name");
    const task = new WorldReplaceTask(inst, hint);
    TaskCenter.addTask(task);
    protocol.response(ctx, { taskId: task.taskId });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Reset the active world (delete -> regenerate on next start).
routerApp.on("world/reset", (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const task = new WorldResetTask(inst);
    TaskCenter.addTask(task);
    protocol.response(ctx, { taskId: task.taskId });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Back up the active world (hot; world-only restorable backup into Backups).
routerApp.on("world/backup", (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const task = new WorldBackupTask(inst);
    TaskCenter.addTask(task);
    protocol.response(ctx, { taskId: task.taskId });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Poll a world task.
routerApp.on("world/task_status", (ctx, data) => {
  try {
    const task = TaskCenter.getTask(data.taskId);
    protocol.response(ctx, task ? task.toObject() : null);
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});
