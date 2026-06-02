import { v4 } from "uuid";
import Instance from "../../entity/instance/instance";
import { $t } from "../../i18n";
import { readLevelName } from "../modpack_files";
import { backupActiveWorld, getActiveWorldPaths, getWorldKind } from "../world_service";
import logger from "../log";
import { AsyncTask, IAsyncTaskJSON } from "./index";

// Hot world-only backup: zip the active world into the Backups area
// (world-<ts>.zip, restorable from the Backups card) WITHOUT stopping the
// server or changing instance status.
export class WorldBackupTask extends AsyncTask {
  public static TYPE = "WorldBackupTask";
  public phase: "backup" | "done" = "backup";

  constructor(public instance: Instance) {
    super();
    this.taskId = `${WorldBackupTask.TYPE}-${instance.instanceUuid}-${v4()}`;
    this.type = WorldBackupTask.TYPE;
  }

  async onStart() {
    const inst = this.instance;
    const status = inst.status();
    if (status === Instance.STATUS_BUSY || status === Instance.STATUS_STARTING) {
      this.error(new Error($t("TXT_CODE_backup.busy")));
      return;
    }
    const cwd = inst.absoluteCwdPath();
    const kind = getWorldKind(inst);
    const levelName = readLevelName(cwd);
    if (getActiveWorldPaths(cwd, kind, levelName).length === 0) {
      this.error(new Error($t("TXT_CODE_world.noWorld")));
      return;
    }
    try {
      this.phase = "backup";
      inst.println("INFO", $t("TXT_CODE_world.backup"));
      await backupActiveWorld(inst);
      this.phase = "done";
      inst.println("INFO", $t("TXT_CODE_world.done"));
    } catch (error: any) {
      this.error(error);
      return;
    }
    this.stop();
  }

  async onStop() {}

  async onError(err: Error) {
    logger.error(`WorldBackupTask error: ${err?.message}`);
    this.instance.println("ERROR", err?.message);
  }

  toObject(): IAsyncTaskJSON {
    return JSON.parse(
      JSON.stringify({
        taskId: this.taskId,
        status: this.status(),
        instanceUuid: this.instance.instanceUuid,
        instanceStatus: this.instance.status(),
        phase: this.phase
      })
    );
  }
}
