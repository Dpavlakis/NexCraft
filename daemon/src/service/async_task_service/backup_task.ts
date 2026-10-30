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
import { indeterminateProgress } from "./operation_progress";

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

  public progress = indeterminateProgress("preparing");

  private targetPath = "";
  private archive?: ReturnType<typeof archiver>;
  private output?: fs.WriteStream;
  private lastProgressOutput = 0;
  private lastProgressCounts = "";
  private finishing = false;
  private cancelled = false;
  private cancelArchive?: () => void;
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
      let finalized = false;
      let discoveredBytes = 0;
      let archiveClosed = false;
      let outputClosed = false;
      let failure: unknown;
      let failed = false;
      let shutdown: Promise<void> | undefined;
      let shuttingDown = false;
      const maybeResolve = () => {
        if (!failed && archiveEnded && finalized && outputClosed) {
          // Closing the output alone is insufficient: also settle the archive
          // transform before retention, restart, or operation success.
          void this.shutdownArchive!().then(() => {
            if (!failed) resolve();
          }, fail);
        }
      };
      archive.on("end", () => {
        archiveEnded = true;
        if (!failed && !this.cancelled) {
          this.progress.phase = "finalization";
          this.progress.totalBytes = discoveredBytes;
        }
        maybeResolve();
      });
      archive.on("close", () => {
        archiveClosed = true;
        // Close without end cannot complete successfully. Give an error emitted
        // in this same turn priority, then fail without waiting for finalize.
        queueMicrotask(() => {
          if (!archiveEnded && !failed && !this.cancelled && !shuttingDown) {
            fail(new Error($t("TXT_CODE_backup.archiveClosedEarly")));
          }
        });
      });
      output.on("close", () => {
        outputClosed = true;
        // Real writable streams distinguish flushed output from destruction.
        // Older test adapters may omit this public property.
        if (output.writableFinished === false && !failed && !this.cancelled && !shuttingDown) {
          fail(new Error($t("TXT_CODE_backup.outputClosedEarly")));
          return;
        }
        maybeResolve();
      });
      this.shutdownArchive = () =>
        (shutdown ||= (async () => {
          shuttingDown = true;
          // Abort drains Archiver's active queue item; destroying the transform
          // alone would leave its source file reader running. Drain before close.
          // A destroyed archive may close without ever emitting end.
          const ended =
            archiveEnded || archiveClosed || archive.readableEnded || archive.closed
              ? Promise.resolve()
              : new Promise<void>((r) => {
                  if (!archive.destroyed) archive.once("end", r);
                  archive.once("close", r);
                });
          const closed =
            outputClosed || output.closed
              ? Promise.resolve()
              : new Promise<void>((r) => output.once("close", r));
          archive.unpipe(output);
          if (!archive.destroyed) {
            archive.abort();
            archive.resume();
          }
          output.destroy();
          await Promise.all([ended, closed]);
          if (!archiveClosed && !archive.closed) {
            const closedArchive = new Promise<void>((r) => archive.once("close", r));
            archive.destroy();
            await closedArchive;
          }
        })());
      const fail = (err: unknown) => {
        if (failed) return;
        failed = true;
        failure = err;
        void this.shutdownArchive!().then(
          () => reject(failure),
          () => reject(failure)
        );
      };
      output.on("error", fail);
      archive.on("warning", (err: any) => {
        if (err?.code === "ENOENT") logger.warn(`BackupTask warning: ${err?.message}`);
        else fail(err);
      });
      archive.on("error", fail);
      this.cancelArchive = () => fail(new Error($t("TXT_CODE_backup.cancelled")));
      this.archive.on("progress", (p) => {
        if (failed || this.cancelled) return;
        this.progress.entries = p.entries.processed;
        this.progress.processedBytes = p.fs.processedBytes;
        discoveredBytes = p.fs.totalBytes;
        // Glob is still discovering files. Its totalBytes is only a moving
        // lower bound, so no percentage or whole-tree total is available yet.
        const counts = `${this.progress.entries}:${this.progress.processedBytes}`;
        const now = Date.now();
        if (counts !== this.lastProgressCounts && now - this.lastProgressOutput >= 1000) {
          this.instance.println(
            "INFO",
            $t("TXT_CODE_backup.progressMeasured", {
              entries: this.progress.entries,
              processedBytes: this.progress.processedBytes
            })
          );
          this.lastProgressOutput = now;
          this.lastProgressCounts = counts;
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
        this.archive.finalize().then(() => {
          finalized = true;
          maybeResolve();
        }, fail);
      } catch (error) {
        fail(error);
      }
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

        if (this.cancelled) throw new Error($t("TXT_CODE_backup.cancelled"));
        if (cfg.shutdown && wasRunning) {
          this.progress.phase = "stop";
          this.instance.println("INFO", $t("TXT_CODE_backup.stopping"));
          await this.instance.execPreset("stop");
          await this.waitForStop();
          stopped = true;
        }

        if (this.cancelled) throw new Error($t("TXT_CODE_backup.cancelled"));
        this.progress.phase = "archive";
        const dir = backupDir(uuid);
        fs.ensureDirSync(dir);
        this.targetPath = path.join(dir, `backup-${backupTimestamp()}-${v4()}.zip`);

        await this.createArchive(cfg);
        if (this.cancelled) throw new Error($t("TXT_CODE_backup.cancelled"));
        this.progress.phase = "finalization";
        backupManager.applyRetention(uuid, cfg.maxBackups);
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
        if (!this.cancelled) await this.error(error);
        return;
      } finally {
        if (stopped) {
          if (!this.cancelled && this.status() !== AsyncTask.STATUS_ERROR)
            this.progress.phase = "restart";
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

      if (this.cancelled || this.status() !== AsyncTask.STATUS_RUNNING) return;
      this.progress.phase = "finalization";
      this.finishing = true;
      await this.stop();
      this.progress = {
        ...this.progress,
        phase: "done",
        percentage: 100,
        indeterminate: false,
        completed: true
      };
      this.instance.println("INFO", $t("TXT_CODE_backup.success"));
    } finally {
      release();
    }
  }

  async onStop() {
    if (!this.finishing && this.status() === AsyncTask.STATUS_RUNNING) {
      this.cancelled = true;
      this.progress.phase = "cancelled";
      this.cancelArchive?.();
    }
    await this.shutdownArchive?.();
    this.archive = undefined;
    this.output = undefined;
  }

  async onError(err: Error) {
    this.progress = {
      ...this.progress,
      phase: "failed",
      percentage: 0,
      completed: false,
      indeterminate: true
    };
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
