import { v4 } from "uuid";
import { decompress } from "../../common/compress";
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

  private async waitForStop(timeoutMs = 60 * 1000) {
    const start = Date.now();
    while (this.instance.status() !== Instance.STATUS_STOP) {
      if (Date.now() - start > timeoutMs) throw new Error($t("TXT_CODE_backup.stopTimeout"));
      await sleep(500);
    }
  }

  async onStart() {
    const status = this.instance.status();
    if (status === Instance.STATUS_BUSY || status === Instance.STATUS_STARTING) {
      this.error(new Error($t("TXT_CODE_backup.busy")));
      return;
    }
    const wasRunning = status === Instance.STATUS_RUNNING;
    try {
      this.instance.println("INFO", $t("TXT_CODE_backup.restoreStart"));
      // Restoring over a live server is unsafe: always stop first.
      if (wasRunning) {
        await this.instance.execPreset("stop");
        await this.waitForStop();
      }
      this.instance.status(Instance.STATUS_BUSY);
      await decompress(this.backupFile, this.instance.absoluteCwdPath(), this.instance.config.fileCode);
      this.instance.println("INFO", $t("TXT_CODE_backup.restoreSuccess"));
    } catch (error: any) {
      this.instance.status(Instance.STATUS_STOP);
      this.error(error);
      return;
    } finally {
      if (this.instance.status() === Instance.STATUS_BUSY)
        this.instance.status(Instance.STATUS_STOP);
      if (wasRunning) {
        try {
          await this.instance.execPreset("start");
        } catch (e) {
          // ignore restart failure
        }
      }
    }
    this.stop();
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
