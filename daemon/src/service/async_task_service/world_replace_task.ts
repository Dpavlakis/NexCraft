import { extractValidatedArchive } from "../restore_service";
import { assertSafePath, validateWorldName } from "../../utils/safe_path";
import { acquireInstanceOperation } from "../instance_operation_lock";
import fs from "fs-extra";
import path from "path";
import { v4 } from "uuid";
import Instance from "../../entity/instance/instance";
import { $t } from "../../i18n";
import { sleep } from "../../utils/sleep";
import logger from "../log";
import { readLevelName } from "../modpack_files";
import {
  WORLD_UPLOAD_DIR,
  backupActiveWorld,
  findWorldRoot,
  getActiveWorldPaths,
  getWorldKind,
  placeWorld,
  wipeActiveWorld
} from "../world_service";
import { AsyncTask, IAsyncTaskJSON } from "./index";

export class WorldReplaceTask extends AsyncTask {
  public static TYPE = "WorldReplaceTask";
  public phase: "backup" | "stop" | "extract" | "apply" | "done" = "backup";

  // hintFileName: the basename the frontend uploaded into WORLD_UPLOAD_DIR.
  constructor(public instance: Instance, public hintFileName: string) {
    super();
    this.taskId = `${WorldReplaceTask.TYPE}-${instance.instanceUuid}-${v4()}`;
    this.type = WorldReplaceTask.TYPE;
  }

  private async waitForStop(timeoutMs = 5 * 60 * 1000) {
    const start = Date.now();
    while (this.instance.status() !== Instance.STATUS_STOP) {
      if (Date.now() - start > timeoutMs) throw new Error($t("TXT_CODE_world.stopTimeout"));
      await sleep(500);
    }
  }

  // Resolve only this task's exact upload; never consume another upload.
  private resolveArchive(uploadDir: string): string {
    validateWorldName(this.hintFileName);
    const exact = assertSafePath(uploadDir, path.join(uploadDir, this.hintFileName));
    if (!fs.statSync(exact).isFile()) throw new Error("Uploaded archive is not a file");
    return exact;
  }

  async onStart() {
    const release = acquireInstanceOperation(this.instance.instanceUuid);
    try {
      const inst = this.instance;
      const cwd = inst.absoluteCwdPath();
      const kind = getWorldKind(inst);
      const levelName = readLevelName(cwd);
      const uploadDir = path.join(cwd, WORLD_UPLOAD_DIR);
      const extractDir = assertSafePath(path.dirname(cwd), path.join(path.dirname(cwd), `.nexcraft-world-${v4()}`));
      let ownedArchive: string | undefined;
      const status = inst.status();
      if (status === Instance.STATUS_BUSY || status === Instance.STATUS_STARTING) {
        await this.error(new Error($t("TXT_CODE_backup.busy")));
        return;
      }
      const wasRunning = status === Instance.STATUS_RUNNING;
      let succeeded = false;

      // Becomes true only once we begin the destructive sequence (stop/backup/wipe).
      // While false, the running server has not been touched.
      let destructiveStarted = false;

      try {
        const archive = this.resolveArchive(uploadDir);
        ownedArchive = archive;
        inst.println("INFO", $t("TXT_CODE_world.replaceStart"));

        // 1) VALIDATE FIRST — extract the upload and confirm it is a real world
        // (contains level.dat) BEFORE touching the running server. A bad archive is
        // rejected here with no stop, no backup, no restart — the server keeps running.
        this.phase = "extract";
        inst.println("INFO", $t("TXT_CODE_world.extracting"));
        await extractValidatedArchive(archive, extractDir, cwd);
        const root = findWorldRoot(extractDir);
        if (!root) throw new Error($t("TXT_CODE_world.noLevelDat"));

        // Archive is valid — begin the destructive sequence.
        destructiveStarted = true;

        // 2) Stop the server (mutating a live world is unsafe).
        if (wasRunning) {
          this.phase = "stop";
          inst.println("INFO", $t("TXT_CODE_world.stopping"));
          await inst.execPreset("stop");
          await this.waitForStop();
        }
        inst.status(Instance.STATUS_BUSY);

        // 3) World-only safety backup (skip if there is no world yet).
        this.phase = "backup";
        if (getActiveWorldPaths(cwd, kind, levelName).length > 0) {
          inst.println("INFO", $t("TXT_CODE_world.backup"));
          await backupActiveWorld(inst);
        }

        // 4) Wipe the active world, then install the validated upload.
        this.phase = "apply";
        inst.println("INFO", $t("TXT_CODE_world.placing"));
        await wipeActiveWorld(cwd, kind, levelName);
        await placeWorld(root, cwd, kind, levelName);

        succeeded = true;
        this.phase = "done";
        inst.println("INFO", $t("TXT_CODE_world.done"));
      } catch (error: any) {
        // Only force STOP if we actually began mutating. A validation failure
        // leaves the server running and untouched.
        if (destructiveStarted) inst.status(Instance.STATUS_STOP);
        await this.error(error);
        return;
      } finally {
        await fs.remove(extractDir).catch(() => {});
        if (ownedArchive) await fs.remove(ownedArchive).catch(() => {});
        if (destructiveStarted && inst.status() === Instance.STATUS_BUSY)
          inst.status(Instance.STATUS_STOP);
        // Restart only on success. On a mid-apply failure the world may be half-wiped
        // (the safety backup is the recovery path), so don't relaunch onto it.
        if (wasRunning && succeeded) {
          try {
            await inst.execPreset("start");
          } catch {
            // ignore restart failure
          }
        } else if (wasRunning && destructiveStarted && !succeeded) {
          inst.println("WARN", $t("TXT_CODE_world.failedStopped"));
        }
      }
      await this.stop();
    } finally { release(); }
  }

  async onStop() {}

  async onError(err: Error) {
    logger.error(`WorldReplaceTask error: ${err?.message}`);
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
