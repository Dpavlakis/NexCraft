import fs from "fs-extra";
import path from "path";
import { v4 } from "uuid";
import Instance from "../../entity/instance/instance";
import { $t } from "../../i18n";
import { sleep } from "../../utils/sleep";
import backupManager from "../backup_service";
import downloadManager from "../download_manager";
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
import type { IModpackInstallDescriptor } from "./modpack_install_task";

export class ModpackUpdateTask extends AsyncTask {
  public static TYPE = "ModpackUpdateTask";

  public phase: "backup" | "stop" | "download" | "apply" | "bootstrap" | "done" = "backup";
  private bootstrap?: ModloaderBootstrap;

  constructor(public instance: Instance, public descriptor: IModpackInstallDescriptor) {
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
      this.error(new Error($t("TXT_CODE_modpack.notModpack")));
      return;
    }
    if (existing.source !== this.descriptor.source) {
      this.error(new Error($t("TXT_CODE_modpack.sourceMismatch")));
      return;
    }
    const wasRunning = inst.status() === Instance.STATUS_RUNNING;
    const staging = path.join(cwd, ".mcsm_update_stage");
    const tmpArchive = path.join(cwd, ".mcsm_update_archive");
    let succeeded = false;

    try {
      // 1) Mandatory pre-update backup (abort entirely if it fails)
      this.phase = "backup";
      inst.println("INFO", $t("TXT_CODE_modpack.updateBackup"));
      await backupManager.startBackupTask(inst.instanceUuid).wait();

      // 2) Stop the server
      if (wasRunning) {
        this.phase = "stop";
        inst.println("INFO", $t("TXT_CODE_backup.restoreStopping"));
        await inst.execPreset("stop");
        await this.waitForStop();
      }
      inst.status(Instance.STATUS_BUSY);

      // 3) Stage the new version into a temp dir
      this.phase = "download";
      await fs.remove(staging);
      await fs.ensureDir(staging);
      let resolved: { mc: string; loader: ModLoader; loaderVersion: string };
      if (this.descriptor.source === "curseforge") {
        if (!this.descriptor.serverPackUrl) throw new Error($t("TXT_CODE_modpack.noServerPack"));
        inst.println("INFO", $t("TXT_CODE_modpack.updateDownloading"));
        await downloadManager.downloadFromUrl(this.descriptor.serverPackUrl, tmpArchive);
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
        await downloadManager.downloadFromUrl(this.descriptor.mrpackUrl, tmpArchive);
        const index = await parseMrpackIndex(tmpArchive);
        const { loader, loaderVersion } = resolveLoader(index.dependencies || {});
        resolved = {
          mc: index.dependencies?.["minecraft"] || existing.mcVersion,
          loader,
          loaderVersion
        };
        await downloadMrpackFiles(index, staging);
        await extractMrpackOverrides(tmpArchive, staging);
      }

      // 4) Replace mods/config/loader artifacts, preserving world + player data
      this.phase = "apply";
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
      this.phase = "bootstrap";
      this.bootstrap = new ModloaderBootstrap({
        instance: inst,
        mcVersion: resolved.mc,
        loader: resolved.loader,
        loaderVersion: resolved.loaderVersion,
        maxMemoryMB: this.descriptor.maxMemoryMB
      });
      const { startCommand } = await this.bootstrap.run();

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
      this.phase = "done";
      inst.println("INFO", $t("TXT_CODE_modpack.updateDone"));
    } catch (error: any) {
      inst.status(Instance.STATUS_STOP);
      this.error(error);
      return;
    } finally {
      await fs.remove(staging).catch(() => {});
      await fs.remove(tmpArchive).catch(() => {});
      if (inst.status() === Instance.STATUS_BUSY) inst.status(Instance.STATUS_STOP);
      // Only restart on success. On failure the mods/loader were already removed,
      // so relaunching would boot a broken server over the live world; leave it
      // stopped (the pre-update backup is the recovery path) and warn.
      if (wasRunning && succeeded) {
        try {
          await inst.execPreset("start");
        } catch {
          // ignore restart failure
        }
      } else if (wasRunning && !succeeded) {
        inst.println("WARN", $t("TXT_CODE_modpack.updateFailedStopped"));
      }
    }
    this.stop();
  }

  async onStop() {
    this.bootstrap?.cancel();
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
        phase: this.phase
      })
    );
  }
}
