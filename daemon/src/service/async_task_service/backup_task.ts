import { acquireInstanceOperation } from "../instance_operation_lock";
import archiver from "archiver";
import fs from "fs-extra";
import path from "path";
import { v4 } from "uuid";
import Instance from "../../entity/instance/instance";
import BackupConfig from "../../entity/instance/backup_config";
import { $t } from "../../i18n";
import backupManager, { backupDir } from "../backup_service";
import logger from "../log";
import { sleep } from "../../utils/sleep";
import { AsyncTask, IAsyncTaskJSON } from "./index";

// Build a filesystem-safe timestamp like 20260528-143501
function backupTimestamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
}

export class BackupTask extends AsyncTask {
  public static TYPE = "BackupTask";

  public progress = {
    percentage: 0,
    processedBytes: 0,
    totalBytes: 0,
    entries: 0
  };

  private targetPath = "";
  private archive?: ReturnType<typeof archiver>;
  private output?: fs.WriteStream;
  private lastProgressOutput = 0;
  private shutdownArchive?: () => Promise<void>;

  constructor(public instance: Instance) {
    super();
    this.taskId = `${BackupTask.TYPE}-${instance.instanceUuid}-${v4()}`;
    this.type = BackupTask.TYPE;
  }

  // Wait until the instance has fully stopped (bounded), used before a shutdown-mode backup.
  private async waitForStop(timeoutMs = 5 * 60 * 1000) {
    const start = Date.now();
    while (this.instance.status() !== Instance.STATUS_STOP) {
      if (Date.now() - start > timeoutMs) throw new Error($t("TXT_CODE_backup.stopTimeout"));
      await sleep(500);
    }
  }

  private createArchive(cfg: BackupConfig): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.output = fs.createWriteStream(this.targetPath);
      this.archive = archiver("zip", cfg.compress ? { zlib: { level: 9 } } : { store: true });

      const archive = this.archive;
      const output = this.output;
      let archiveEnded = false;
      let archiveClosed = false;
      let outputClosed = false;
      let failure: unknown;
      let failed = false;
      let shutdown: Promise<void> | undefined;
      archive.on("end", () => { archiveEnded = true; });
      archive.on("close", () => { archiveClosed = true; });
      output.on("close", () => {
        outputClosed = true;
        if (!failed) resolve();
      });
      this.shutdownArchive = () => shutdown ||= (async () => {
        // Abort drains Archiver's active queue item; destroying the transform
        // alone would leave its source file reader running. Drain before close.
        // A destroyed archive may close without ever emitting end.
        const ended = archiveEnded || archiveClosed || archive.readableEnded || archive.closed
          ? Promise.resolve()
          : new Promise<void>(r => {
              if (!archive.destroyed) archive.once("end", r);
              archive.once("close", r);
            });
        const closed = outputClosed || output.closed ? Promise.resolve() : new Promise<void>(r => output.once("close", r));
        archive.unpipe(output);
        if (!archive.destroyed) { archive.abort(); archive.resume(); }
        output.destroy();
        await Promise.all([ended, closed]);
        if (!archiveClosed && !archive.closed) {
          const closedArchive = new Promise<void>(r => archive.once("close", r));
          archive.destroy();
          await closedArchive;
        }
      })();
      const fail = (err: unknown) => {
        if (failed) return;
        failed = true;
        failure = err;
        void this.shutdownArchive!().then(() => reject(failure), () => reject(failure));
      };
      output.on("error", fail);
      archive.on("warning", (err: any) => {
        if (err?.code === "ENOENT") logger.warn(`BackupTask warning: ${err?.message}`);
        else fail(err);
      });
      archive.on("error", fail);
      this.archive.on("progress", (p) => {
        this.progress.entries = p.entries.processed;
        this.progress.processedBytes = p.fs.processedBytes;
        this.progress.totalBytes = p.fs.totalBytes;
        if (this.progress.totalBytes > 0) {
          this.progress.percentage = Math.min(
            100,
            Math.round((this.progress.processedBytes / this.progress.totalBytes) * 100)
          );
        }
        const now = Date.now();
        if (now - this.lastProgressOutput >= 1000) {
          this.instance.println(
            "INFO",
            $t("TXT_CODE_backup.progress", { percentage: this.progress.percentage })
          );
          this.lastProgressOutput = now;
        }
      });

      try {
        this.archive.pipe(this.output);
        // Recursively archive the whole working directory, honoring exclusion globs.
        this.archive.glob("**/*", {
          cwd: this.instance.absoluteCwdPath(),
          dot: true,
          ignore: cfg.exclusions || []
        });
        this.archive.finalize().catch(fail);
      } catch (error) { fail(error); }
    });
  }

  async onStart() {
    const release = acquireInstanceOperation(this.instance.instanceUuid);
    try {
      const uuid = this.instance.instanceUuid;
      const cfg = backupManager.getConfig(uuid);
      const wasRunning = this.instance.status() === Instance.STATUS_RUNNING;
      let stopped = false;

      try {
        this.instance.println("INFO", $t("TXT_CODE_backup.start"));

        if (cfg.preCommand && this.instance.status() === Instance.STATUS_RUNNING) {
          await this.instance.execPreset("command", cfg.preCommand);
        }

        if (cfg.shutdown && wasRunning) {
          this.instance.println("INFO", $t("TXT_CODE_backup.stopping"));
          await this.instance.execPreset("stop");
          await this.waitForStop();
          stopped = true;
        }

        const dir = backupDir(uuid);
        fs.ensureDirSync(dir);
        this.targetPath = path.join(dir, `backup-${backupTimestamp()}-${v4()}.zip`);

        await this.createArchive(cfg);
        backupManager.applyRetention(uuid, cfg.maxBackups);

        this.instance.println("INFO", $t("TXT_CODE_backup.success"));
      } catch (error: any) {
        await this.shutdownArchive?.();
        // Clean up a partial archive only after every stream has shut down.
        if (this.targetPath && fs.existsSync(this.targetPath)) {
          try {
            fs.removeSync(this.targetPath);
          } catch (e) {
            // ignore
          }
        }
        await this.error(error);
        return;
      } finally {
        if (stopped) {
          try {
            await this.instance.execPreset("start");
          } catch (e) {
            // ignore restart failure
          }
        }
        if (cfg.postCommand && this.instance.status() === Instance.STATUS_RUNNING) {
          try {
            await this.instance.execPreset("command", cfg.postCommand);
          } catch (e) {
            // ignore
          }
        }
      }

      await this.stop();
    } finally { release(); }
  }

  async onStop() {
    await this.shutdownArchive?.();
    this.archive = undefined;
    this.output = undefined;
  }

  async onError(err: Error) {
    this.instance.println("ERROR", err?.message);
  }

  toObject(): IAsyncTaskJSON {
    return JSON.parse(
      JSON.stringify({
        taskId: this.taskId,
        status: this.status(),
        instanceUuid: this.instance.instanceUuid,
        instanceStatus: this.instance.status(),
        progress: this.progress
      })
    );
  }
}
