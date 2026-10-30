import fs from "fs-extra";
import path from "path";
import { v4 } from "uuid";
import Instance from "../../entity/instance/instance";
import { $t } from "../../i18n";
import { sleep } from "../../utils/sleep";
import backupManager from "../backup_service";
import downloadManager, { DOWNLOAD_STATUS } from "../download_manager";
import { ModloaderBootstrap, type ModLoader } from "../modloader_bootstrap";
import {
  clearReplaceableArtifacts,
  downloadMrpackFiles,
  extractMrpackOverrides,
  extractZipOverwrite,
  makeShouldPreserve,
  maybeFlatten,
  parseMrpackIndex,
  removeKnownClientMods,
  resolveLoader
} from "../modpack_files";
import { AsyncTask, IAsyncTaskJSON } from "./index";
import { indeterminateProgress, measuredProgress } from "./operation_progress";
import type { IModpackInstallDescriptor } from "./modpack_install_task";

export class ModpackUpdateTask extends AsyncTask {
  public static TYPE = "ModpackUpdateTask";

  public phase: "backup" | "stop" | "download" | "apply" | "bootstrap" | "done" = "backup";
  private bootstrap?: ModloaderBootstrap;
  private stageProgress = indeterminateProgress("backup");
  private childBackup?: ReturnType<typeof backupManager.startBackupTask>;
  private archiveDownload?: (typeof downloadManager.tasks)[number];
  private cancelled = false;
  private finishing = false;

  public get progress() {
    if (this.stageProgress.phase === "backup" && this.childBackup) {
      const child = this.childBackup.progress;
      return { ...child, phase: "backup", percentage: 0, indeterminate: true, completed: false };
    }
    if (this.stageProgress.phase === "download" && this.archiveDownload) {
      return measuredProgress("download", this.archiveDownload.current, this.archiveDownload.total);
    }
    return this.stageProgress;
  }

  // Keep the legacy download shape available as well as the operation progress.
  public get downloadProgress() {
    const p = this.progress;
    return {
      percentage: p.percentage,
      downloadedBytes: p.processedBytes,
      totalBytes: p.totalBytes
    };
  }

  private ensureActive() {
    if (this.cancelled) throw new Error($t("TXT_CODE_modpack.updateCancelled"));
  }

  private setPhase(phase: typeof this.phase) {
    this.ensureActive();
    this.phase = phase;
    this.stageProgress = indeterminateProgress(phase);
  }

  private async downloadArchive(url: string, target: string) {
    const download = downloadManager.downloadFromUrl(url, target);
    // The manager registers synchronously before its first await. Keep the
    // actual record, even if its delayed cleanup removes it from the list.
    this.archiveDownload = downloadManager.tasks.filter((task) => task.path === target).pop();
    await download;
    this.ensureActive();
    if (
      this.archiveDownload?.controller.signal.aborted ||
      this.archiveDownload?.status === DOWNLOAD_STATUS.ERROR
    ) {
      throw new Error($t("TXT_CODE_modpack.updateCancelled"));
    }
    this.archiveDownload = undefined;
    // Extraction/index discovery has no stable total, even when the archive
    // itself has finished downloading.
    this.stageProgress = indeterminateProgress("download");
  }

  constructor(
    public instance: Instance,
    public descriptor: IModpackInstallDescriptor
  ) {
    super();
    this.taskId = `${ModpackUpdateTask.TYPE}-${instance.instanceUuid}-${v4()}`;
    this.type = ModpackUpdateTask.TYPE;
  }

  private async waitForStop(timeoutMs = 5 * 60 * 1000) {
    const start = Date.now();
    while (this.instance.status() !== Instance.STATUS_STOP) {
      if (Date.now() - start > timeoutMs) throw new Error($t("TXT_CODE_backup.stopTimeout"));
      await sleep(500);
    }
  }

  async onStart() {
    const inst = this.instance;
    const cwd = inst.absoluteCwdPath();
    const existing = inst.config.packInfo;
    if (!existing) {
      await this.error(new Error($t("TXT_CODE_modpack.notModpack")));
      return;
    }
    if (existing.source !== this.descriptor.source) {
      await this.error(new Error($t("TXT_CODE_modpack.sourceMismatch")));
      return;
    }
    const wasRunning = inst.status() === Instance.STATUS_RUNNING;
    const staging = path.join(cwd, ".mcsm_update_stage");
    const tmpArchive = path.join(cwd, ".mcsm_update_archive");
    let succeeded = false;

    try {
      // 1) Mandatory pre-update backup (abort entirely if it fails)
      this.setPhase("backup");
      inst.println("INFO", $t("TXT_CODE_modpack.updateBackup"));
      this.childBackup = backupManager.startBackupTask(inst.instanceUuid);
      await this.childBackup.wait();
      this.ensureActive();

      // 2) Stop the server
      if (wasRunning) {
        this.setPhase("stop");
        inst.println("INFO", $t("TXT_CODE_backup.restoreStopping"));
        await inst.execPreset("stop");
        await this.waitForStop();
      }
      this.ensureActive();
      inst.status(Instance.STATUS_BUSY);

      // 3) Stage the new version into a temp dir
      this.setPhase("download");
      await fs.remove(staging);
      await fs.ensureDir(staging);
      this.ensureActive();
      let resolved: { mc: string; loader: ModLoader; loaderVersion: string };
      if (this.descriptor.source === "curseforge") {
        if (!this.descriptor.serverPackUrl) throw new Error($t("TXT_CODE_modpack.noServerPack"));
        inst.println("INFO", $t("TXT_CODE_modpack.updateDownloading"));
        await this.downloadArchive(this.descriptor.serverPackUrl, tmpArchive);
        await extractZipOverwrite(tmpArchive, staging);
        await maybeFlatten(staging);
        resolved = {
          mc: this.descriptor.mcVersion || existing.mcVersion,
          loader: (this.descriptor.loader || existing.loader) as ModLoader,
          loaderVersion: this.descriptor.loaderVersion || existing.loaderVersion
        };
      } else {
        if (!this.descriptor.mrpackUrl) throw new Error($t("TXT_CODE_modpack.noMrpack"));
        inst.println("INFO", $t("TXT_CODE_modpack.updateDownloading"));
        await this.downloadArchive(this.descriptor.mrpackUrl, tmpArchive);
        const index = await parseMrpackIndex(tmpArchive);
        const { loader, loaderVersion } = resolveLoader(index.dependencies || {});
        resolved = {
          mc: index.dependencies?.["minecraft"] || existing.mcVersion,
          loader,
          loaderVersion
        };
        this.ensureActive();
        await downloadMrpackFiles(index, staging, (done) => {
          if (!this.cancelled) this.stageProgress.entries = done;
        });
        this.ensureActive();
        await extractMrpackOverrides(tmpArchive, staging);
      }

      // 4) Replace mods/config/loader artifacts, preserving world + player data
      this.setPhase("apply");
      inst.println("INFO", $t("TXT_CODE_modpack.updateApplying"));
      await clearReplaceableArtifacts(cwd);
      const skip = makeShouldPreserve(cwd);
      await fs.copy(staging, cwd, {
        overwrite: true,
        filter: (src) => {
          const rel = path.relative(staging, src);
          if (!rel) return true;
          return !skip(rel);
        }
      });

      // Strip client-only mods that crash a dedicated server (e.g. e4mc).
      try {
        const removed = await removeKnownClientMods(cwd);
        if (removed.length) {
          inst.println(
            "INFO",
            $t("TXT_CODE_modpack.removedClientMods", { mods: removed.join(", ") })
          );
        }
      } catch {
        // non-fatal
      }

      // 5) Re-bootstrap the modloader for the new version
      this.setPhase("bootstrap");
      this.bootstrap = new ModloaderBootstrap({
        instance: inst,
        mcVersion: resolved.mc,
        loader: resolved.loader,
        loaderVersion: resolved.loaderVersion,
        maxMemoryMB: this.descriptor.maxMemoryMB
      });
      const { startCommand } = await this.bootstrap.run();
      this.ensureActive();
      this.stageProgress = indeterminateProgress("finalization");

      inst.parameters(
        {
          startCommand,
          packInfo: {
            ...existing,
            ...this.descriptor.packInfo,
            mcVersion: resolved.mc,
            loader: resolved.loader,
            loaderVersion: resolved.loaderVersion,
            installedAt: Date.now()
          }
        },
        true
      );

      succeeded = true;
    } catch (error: any) {
      inst.status(Instance.STATUS_STOP);
      if (!this.cancelled) await this.error(error);
      return;
    } finally {
      let cleanupError: Error | undefined;
      await fs.remove(staging).catch((error: Error) => {
        cleanupError ||= error;
      });
      await fs.remove(tmpArchive).catch((error: Error) => {
        cleanupError ||= error;
      });
      if (inst.status() === Instance.STATUS_BUSY) inst.status(Instance.STATUS_STOP);
      // Preserve the primary failure, but do not claim whole-operation success
      // when staging/archive cleanup itself failed.
      if (cleanupError && !this.cancelled && this.status() !== AsyncTask.STATUS_ERROR) {
        succeeded = false;
        await this.error(cleanupError);
      }
      // Only restart on success. On failure the mods/loader were already removed,
      // so relaunching would boot a broken server over the live world; leave it
      // stopped (the pre-update backup is the recovery path) and warn.
      if (wasRunning && succeeded && !this.cancelled) {
        try {
          await inst.execPreset("start");
        } catch {
          // ignore restart failure
        }
      } else if (wasRunning && !succeeded) {
        inst.println("WARN", $t("TXT_CODE_modpack.updateFailedStopped"));
      }
    }
    if (this.cancelled || this.status() !== AsyncTask.STATUS_RUNNING) return;
    this.finishing = true;
    await this.stop();
    this.phase = "done";
    this.stageProgress = {
      ...indeterminateProgress("done"),
      percentage: 100,
      indeterminate: false,
      completed: true
    };
    inst.println("INFO", $t("TXT_CODE_modpack.updateDone"));
  }

  async onStop() {
    if (!this.finishing && this.status() === AsyncTask.STATUS_RUNNING) {
      this.cancelled = true;
      this.stageProgress = {
        ...this.progress,
        phase: "cancelled",
        percentage: 0,
        indeterminate: true,
        completed: false
      };
    }
    this.bootstrap?.cancel();
  }

  async onError(err: Error) {
    this.stageProgress = {
      ...this.progress,
      phase: "failed",
      percentage: 0,
      indeterminate: true,
      completed: false
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
        phase: this.phase,
        progress: this.progress,
        downloadProgress: this.phase === "download" ? this.downloadProgress : undefined
      })
    );
  }
}
