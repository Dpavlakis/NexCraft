import schedule from "node-schedule";
import Instance from "../entity/instance/instance";
import logger from "./log";
import { sleep } from "../utils/sleep";

// Humanize a seconds value for the {time} placeholder in warning messages.
function humanizeSeconds(s: number): string {
  if (s % 3600 === 0 && s >= 3600) {
    const h = s / 3600;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  if (s % 60 === 0 && s >= 60) {
    const m = s / 60;
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  return `${s} second${s === 1 ? "" : "s"}`;
}

interface IRestartJob {
  cancel(): void;
}

class IntervalRestartJob implements IRestartJob {
  private handle: ReturnType<typeof setInterval>;
  constructor(callback: () => void, seconds: number) {
    this.handle = setInterval(callback, seconds * 1000);
  }
  cancel() {
    clearInterval(this.handle);
  }
}

class ScheduledRestartService {
  private jobs = new Map<string, IRestartJob>();
  // Guards against overlapping runs (a long countdown still running when the next fires).
  private running = new Set<string>();

  // (Re)arm the scheduled restart for an instance from its current config.
  public applyForInstance(instance: Instance) {
    const uuid = instance.instanceUuid;
    this.cancelForInstance(uuid);
    const cfg = instance.config?.scheduledRestart;
    if (!cfg || !cfg.enabled) return;

    const run = () => {
      this.runRestartSequence(instance).catch((e) =>
        logger.error(`[scheduledRestart] ${uuid} error: ${e?.message ?? e}`)
      );
    };

    try {
      if (cfg.scheduleType === 1) {
        const secs = Math.max(60, Number(cfg.intervalSeconds) || 0);
        this.jobs.set(uuid, new IntervalRestartJob(run, secs));
      } else {
        const job = schedule.scheduleJob(cfg.cron, run);
        if (!job) {
          logger.warn(`[scheduledRestart] ${uuid} invalid cron: ${cfg.cron}`);
          return;
        }
        this.jobs.set(uuid, { cancel: () => job.cancel() });
      }
      logger.info(`[scheduledRestart] armed ${uuid} (type=${cfg.scheduleType})`);
    } catch (e: any) {
      logger.error(`[scheduledRestart] ${uuid} failed to arm: ${e?.message ?? e}`);
    }
  }

  public cancelForInstance(uuid: string) {
    const j = this.jobs.get(uuid);
    if (j) {
      try {
        j.cancel();
      } catch {}
      this.jobs.delete(uuid);
    }
  }

  // Broadcast the countdown then restart. Skips if not running; aborts if the
  // instance leaves RUNNING mid-countdown (e.g. admin stopped it).
  private async runRestartSequence(instance: Instance) {
    const uuid = instance.instanceUuid;
    if (this.running.has(uuid)) return;
    if (instance.status() !== Instance.STATUS_RUNNING) {
      logger.info(`[scheduledRestart] ${uuid} skipped (not running)`);
      return;
    }
    this.running.add(uuid);
    try {
      const cfg = instance.config.scheduledRestart;
      const tmpl = cfg.warningMessage || "Server restarting in {time}...";
      const points = [...(cfg.warningSeconds || [])]
        .map((n) => Math.floor(Number(n)))
        .filter((n) => n > 0)
        .sort((a, b) => b - a);

      for (let i = 0; i < points.length; i++) {
        if (instance.status() !== Instance.STATUS_RUNNING) {
          logger.info(`[scheduledRestart] ${uuid} aborted mid-countdown (not running)`);
          return;
        }
        const w = points[i];
        const msg = tmpl.replace("{time}", humanizeSeconds(w));
        try {
          await instance.execPreset("command", `say ${msg}`);
        } catch (e: any) {
          logger.warn(`[scheduledRestart] ${uuid} say failed: ${e?.message ?? e}`);
        }
        const next = i + 1 < points.length ? points[i + 1] : 0;
        const waitMs = (w - next) * 1000;
        if (waitMs > 0) await sleep(waitMs);
      }

      if (instance.status() !== Instance.STATUS_RUNNING) {
        logger.info(`[scheduledRestart] ${uuid} aborted before restart (not running)`);
        return;
      }
      logger.info(`[scheduledRestart] ${uuid} restarting now`);
      await instance.execPreset("restart");
    } finally {
      this.running.delete(uuid);
    }
  }
}

export default new ScheduledRestartService();
