import { v4 } from "uuid";
import Instance from "../../entity/instance/instance";
import { $t } from "../../i18n";
import { sleep } from "../../utils/sleep";
import logger from "../log";
import { readLevelName } from "../modpack_files";
import { backupActiveWorld, getActiveWorldPaths, getWorldKind, wipeActiveWorld } from "../world_service";
import { AsyncTask, IAsyncTaskJSON } from "./index";

export class WorldResetTask extends AsyncTask {
  public static TYPE = "WorldResetTask";
  public phase: "backup" | "stop" | "wipe" | "done" = "backup";

  constructor(public instance: Instance) {
    super();
    this.taskId = `${WorldResetTask.TYPE}-${instance.instanceUuid}-${v4()}`;
    this.type = WorldResetTask.TYPE;
  }

  private async waitForStop(timeoutMs = 5 * 60 * 1000) {
    const start = Date.now();
    while (this.instance.status() !== Instance.STATUS_STOP) {
      if (Date.now() - start > timeoutMs) throw new Error($t("TXT_CODE_world.stopTimeout"));
      await sleep(500);
    }
  }

  async onStart() {
    const inst = this.instance;
    const cwd = inst.absoluteCwdPath();
    const kind = getWorldKind(inst);
    const levelName = readLevelName(cwd);
    const status = inst.status();
    if (status === Instance.STATUS_BUSY || status === Instance.STATUS_STARTING) {
      this.error(new Error($t("TXT_CODE_backup.busy")));
      return;
    }
    const wasRunning = status === Instance.STATUS_RUNNING;
    let succeeded = false;

    try {
      inst.println("INFO", $t("TXT_CODE_world.resetStart"));

      // 1) Stop.
      if (wasRunning) {
        this.phase = "stop";
        inst.println("INFO", $t("TXT_CODE_world.stopping"));
        await inst.execPreset("stop");
        await this.waitForStop();
      }
      inst.status(Instance.STATUS_BUSY);

      // 2) World-only safety backup (skip if no world yet).
      this.phase = "backup";
      if (getActiveWorldPaths(cwd, kind, levelName).length > 0) {
        inst.println("INFO", $t("TXT_CODE_world.backup"));
        await backupActiveWorld(inst);
      }

      // 3) Remove the active world; the server regenerates it on next start.
      this.phase = "wipe";
      await wipeActiveWorld(cwd, kind, levelName);

      succeeded = true;
      this.phase = "done";
      inst.println("INFO", $t("TXT_CODE_world.done"));
    } catch (error: any) {
      inst.status(Instance.STATUS_STOP);
      this.error(error);
      return;
    } finally {
      if (inst.status() === Instance.STATUS_BUSY) inst.status(Instance.STATUS_STOP);
      if (wasRunning && succeeded) {
        try {
          await inst.execPreset("start");
        } catch {
          // ignore restart failure
        }
      } else if (wasRunning && !succeeded) {
        inst.println("WARN", $t("TXT_CODE_world.failedStopped"));
      }
    }
    this.stop();
  }

  async onStop() {}

  async onError(err: Error) {
    logger.error(`WorldResetTask error: ${err?.message}`);
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
