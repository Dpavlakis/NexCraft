import fs from "fs-extra";
import path from "path";
import StorageSubsystem from "../common/system_storage";
import BackupConfig from "../entity/instance/backup_config";
import Instance from "../entity/instance/instance";
import { $t } from "../i18n";
import { BackupTask } from "./async_task_service/backup_task";
import { RestoreTask } from "./async_task_service/restore_task";
import { TaskCenter } from "./async_task_service/index";
import FileManager from "./system_file";
import InstanceSubsystem from "./system_instance";

const STORAGE_CATEGORY = "BackupConfig";
// Backups live under the daemon data directory, deliberately outside any instance working
// directory, so they are never included in their own archive and survive instance data resets.
export const BACKUP_ROOT = path.normalize(path.join(process.cwd(), "data", "backups"));

export function backupDir(instanceUuid: string) {
  return path.normalize(path.join(BACKUP_ROOT, instanceUuid));
}

export interface IBackupItem {
  name: string;
  size: number;
  time: number;
}

class BackupManager {
  public getConfig(instanceUuid: string): BackupConfig {
    const cfg = StorageSubsystem.load(STORAGE_CATEGORY, BackupConfig, instanceUuid) as BackupConfig;
    return cfg || new BackupConfig();
  }

  public setConfig(instanceUuid: string, data: Partial<BackupConfig>): BackupConfig {
    const cfg = this.getConfig(instanceUuid);
    if (data.compress != null) cfg.compress = Boolean(data.compress);
    if (data.maxBackups != null) cfg.maxBackups = Math.max(0, Math.floor(Number(data.maxBackups)));
    if (data.exclusions != null)
      cfg.exclusions = (data.exclusions as string[]).map((v) => String(v)).filter((v) => v !== "");
    if (data.shutdown != null) cfg.shutdown = Boolean(data.shutdown);
    if (data.preCommand != null) cfg.preCommand = String(data.preCommand);
    if (data.postCommand != null) cfg.postCommand = String(data.postCommand);
    StorageSubsystem.store(STORAGE_CATEGORY, instanceUuid, cfg);
    return cfg;
  }

  public list(instanceUuid: string): IBackupItem[] {
    const dir = backupDir(instanceUuid);
    if (!fs.existsSync(dir)) return [];
    const result: IBackupItem[] = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.toLowerCase().endsWith(".zip")) continue;
      try {
        const stat = fs.statSync(path.join(dir, name));
        if (!stat.isFile()) continue;
        result.push({ name, size: stat.size, time: stat.mtimeMs });
      } catch (error) {
        // ignore unreadable entries
      }
    }
    // newest first
    return result.sort((a, b) => b.time - a.time);
  }

  // Resolve a backup file name to an absolute path, guarding against path traversal.
  public resolveBackupFile(instanceUuid: string, fileName: string): string {
    if (!FileManager.checkFileName(fileName) || path.basename(fileName) !== fileName)
      throw new Error($t("TXT_CODE_backup.illegalName"));
    const dir = backupDir(instanceUuid);
    const abs = path.normalize(path.join(dir, fileName));
    if (abs !== path.join(dir, fileName) || !abs.startsWith(dir + path.sep))
      throw new Error($t("TXT_CODE_backup.illegalName"));
    if (!fs.existsSync(abs)) throw new Error($t("TXT_CODE_backup.fileNotExist"));
    return abs;
  }

  public delete(instanceUuid: string, fileName: string) {
    const abs = this.resolveBackupFile(instanceUuid, fileName);
    fs.removeSync(abs);
  }

  // Delete the oldest backups when the count exceeds maxBackups (0 = keep all).
  public applyRetention(instanceUuid: string, maxBackups: number) {
    if (!maxBackups || maxBackups <= 0) return;
    const backups = this.list(instanceUuid); // newest first
    for (const old of backups.slice(maxBackups)) {
      try {
        fs.removeSync(path.join(backupDir(instanceUuid), old.name));
      } catch (error) {
        // ignore deletion errors during retention
      }
    }
  }

  public startBackupTask(instanceUuid: string): BackupTask {
    const instance = InstanceSubsystem.getInstance(instanceUuid);
    if (!instance) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const task = new BackupTask(instance);
    TaskCenter.addTask(task);
    return task;
  }

  public startRestoreTask(instanceUuid: string, fileName: string): RestoreTask {
    const instance = InstanceSubsystem.getInstance(instanceUuid);
    if (!instance) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const abs = this.resolveBackupFile(instanceUuid, fileName);
    const task = new RestoreTask(instance, abs);
    TaskCenter.addTask(task);
    return task;
  }
}

export default new BackupManager();
