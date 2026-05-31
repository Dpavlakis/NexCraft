import fs from "fs-extra";
import StreamZip from "node-stream-zip";
import path from "path";
import { v4 } from "uuid";
import Instance from "../../entity/instance/instance";
import { $t } from "../../i18n";
import { sleep } from "../../utils/sleep";
import logger from "../log";
import { readLevelName } from "../modpack_files";
import {
  WORLD_EXTRACT_DIR,
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

  // Resolve the uploaded archive: prefer the exact hinted name, else newest
  // .zip/.mcworld in the upload dir (in case the upload transport renamed it).
  private resolveArchive(uploadDir: string): string {
    const exact = path.join(uploadDir, this.hintFileName);
    if (this.hintFileName && fs.existsSync(exact) && fs.statSync(exact).isFile()) return exact;
    let candidates: Array<{ p: string; t: number }> = [];
    try {
      candidates = fs
        .readdirSync(uploadDir)
        .filter((n) => /\.(zip|mcworld)$/i.test(n))
        .map((n) => ({ p: path.join(uploadDir, n), t: fs.statSync(path.join(uploadDir, n)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
    } catch {
      // dir missing
    }
    if (candidates.length === 0) throw new Error($t("TXT_CODE_world.noLevelDat"));
    return candidates[0].p;
  }

  async onStart() {
    const inst = this.instance;
    const cwd = inst.absoluteCwdPath();
    const kind = getWorldKind(inst);
    const levelName = readLevelName(cwd);
    const uploadDir = path.join(cwd, WORLD_UPLOAD_DIR);
    const extractDir = path.join(cwd, WORLD_EXTRACT_DIR);
    const status = inst.status();
    if (status === Instance.STATUS_BUSY || status === Instance.STATUS_STARTING) {
      this.error(new Error($t("TXT_CODE_backup.busy")));
      return;
    }
    const wasRunning = status === Instance.STATUS_RUNNING;
    let succeeded = false;

    try {
      const archive = this.resolveArchive(uploadDir);
      inst.println("INFO", $t("TXT_CODE_world.replaceStart"));

      // 1) Stop the server (mutating a live world is unsafe).
      if (wasRunning) {
        this.phase = "stop";
        inst.println("INFO", $t("TXT_CODE_world.stopping"));
        await inst.execPreset("stop");
        await this.waitForStop();
      }
      inst.status(Instance.STATUS_BUSY);

      // 2) World-only safety backup (skip if there is no world yet).
      this.phase = "backup";
      if (getActiveWorldPaths(cwd, kind, levelName).length > 0) {
        inst.println("INFO", $t("TXT_CODE_world.backup"));
        await backupActiveWorld(inst);
      }

      // 3) Extract the upload and detect the world root.
      this.phase = "extract";
      inst.println("INFO", $t("TXT_CODE_world.extracting"));
      await fs.remove(extractDir);
      await fs.ensureDir(extractDir);
      const zip = new StreamZip.async({ file: archive });
      try {
        await zip.extract(null, extractDir);
      } finally {
        await zip.close();
      }
      const root = findWorldRoot(extractDir);
      if (!root) throw new Error($t("TXT_CODE_world.noLevelDat"));

      // 4) Wipe the active world, then install the uploaded one.
      this.phase = "apply";
      inst.println("INFO", $t("TXT_CODE_world.placing"));
      await wipeActiveWorld(cwd, kind, levelName);
      await placeWorld(root, cwd, kind, levelName);

      succeeded = true;
      this.phase = "done";
      inst.println("INFO", $t("TXT_CODE_world.done"));
    } catch (error: any) {
      inst.status(Instance.STATUS_STOP);
      this.error(error);
      return;
    } finally {
      await fs.remove(extractDir).catch(() => {});
      await fs.remove(uploadDir).catch(() => {});
      if (inst.status() === Instance.STATUS_BUSY) inst.status(Instance.STATUS_STOP);
      // Restart only on success: a mid-apply failure may have wiped the world
      // (the safety backup is the recovery path), so do not relaunch onto it.
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
