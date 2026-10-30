import fs from "fs-extra";
import { prepareRestore, applyRestore } from "../restore_service";
import { acquireInstanceOperation } from "../instance_operation_lock";
import { v4 } from "uuid";
import Instance from "../../entity/instance/instance";
import { $t } from "../../i18n";
import logger from "../log";
import { sleep } from "../../utils/sleep";
import { AsyncTask, IAsyncTaskJSON } from "./index";

export class RestoreTask extends AsyncTask {
  public static TYPE = "RestoreTask";

  constructor(public instance: Instance, public backupFile: string) {
    super();
    this.taskId = `${RestoreTask.TYPE}-${instance.instanceUuid}-${v4()}`;
    this.type = RestoreTask.TYPE;
  }

  private async waitForStop(timeoutMs = 5 * 60 * 1000) {
    const start = Date.now();
    while (this.instance.status() !== Instance.STATUS_STOP) {
      if (Date.now() - start > timeoutMs) throw new Error($t("TXT_CODE_backup.stopTimeout"));
      await sleep(500);
    }
  }

  async onStart() {
    const release = acquireInstanceOperation(this.instance.instanceUuid);
    let stage: string | undefined;
    let stopped = false;
    try {
      const status = this.instance.status();
      if (status === Instance.STATUS_BUSY || status === Instance.STATUS_STARTING)
        throw new Error($t("TXT_CODE_backup.busy"));
      const wasRunning = status === Instance.STATUS_RUNNING;
      const cwd = this.instance.absoluteCwdPath();
      const prepared = await prepareRestore(this.backupFile, cwd);
      stage = prepared.stage;
      if (wasRunning) {
        await this.instance.execPreset("stop");
        await this.waitForStop();
      }
      stopped = true;
      this.instance.status(Instance.STATUS_BUSY);
      await applyRestore(prepared.stage, cwd, prepared.units);
      await fs.remove(stage);
      stage = undefined;
      this.instance.status(Instance.STATUS_STOP);
      if (wasRunning) await this.instance.execPreset("start");
      this.instance.println("INFO", $t("TXT_CODE_backup.restoreSuccess"));
    } catch (error: any) {
      if (stopped) this.instance.status(Instance.STATUS_STOP);
      // Cleanup belongs to the operation, before reporting completion. Preserve
      // the primary failure if removing the remaining stage also fails.
      if (stage) {
        try { await fs.remove(stage); } catch (cleanupError) {
          logger.error("Restore stage cleanup failed; retained at " + stage, cleanupError);
        }
        stage = undefined;
      }
      await this.error(error);
      return;
    } finally {
      release();
    }
    await this.stop();
  }

  async onStop() {
    // Decompression cannot be safely interrupted mid-write; nothing to clean up here.
  }

  async onError(err: Error) {
    logger.error(`RestoreTask error: ${err?.message}`);
    this.instance.println("ERROR", err?.message);
  }

  toObject(): IAsyncTaskJSON {
    return JSON.parse(
      JSON.stringify({
        taskId: this.taskId,
        status: this.status(),
        instanceUuid: this.instance.instanceUuid,
        instanceStatus: this.instance.status()
      })
    );
  }
}
