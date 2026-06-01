import { ILifeCycleTask } from "../../instance/life_cycle";
import Instance from "../../instance/instance";
import logger from "../../../service/log";

// Auto-stops the instance after it has had 0 players for the configured idle
// timeout. Reads instance.info.currentPlayers (refreshed every 10s by the ping
// task). Works for Java and Bedrock. Registered for all Minecraft instances; a
// no-op unless sleepOnEmpty.enabled.
export default class SleepOnEmptyTask implements ILifeCycleTask {
  public status: number = 0;
  public name: string = "SleepOnEmpty";

  private task?: NodeJS.Timeout;
  private emptySince: number | null = null;
  private seenOnline = false;

  async start(instance: Instance) {
    this.emptySince = null;
    this.seenOnline = false;
    this.task = setInterval(() => {
      try {
        this.tick(instance);
      } catch (e: any) {
        logger.warn(`[sleep] ${instance.instanceUuid} tick error: ${e?.message ?? e}`);
      }
    }, 1000 * 30);
  }

  private tick(instance: Instance) {
    const cfg = instance.config?.sleepOnEmpty;
    if (!cfg || !cfg.enabled) {
      this.emptySince = null;
      return;
    }
    if (instance.status() !== Instance.STATUS_RUNNING) return;
    // Don't count empties until the server's ping has actually come online once,
    // so a slow boot (ping not yet populated) isn't mistaken for "empty".
    if (!instance.info.mcPingOnline) return;
    this.seenOnline = true;

    const players = Number(instance.info.currentPlayers) || 0;
    if (players > 0) {
      this.emptySince = null;
      return;
    }
    if (this.emptySince === null) {
      this.emptySince = Date.now();
      return;
    }
    const idleMs = Math.max(1, Number(cfg.idleTimeoutMinutes) || 0) * 60_000;
    if (Date.now() - this.emptySince >= idleMs) {
      logger.info(
        `[sleep] ${instance.instanceUuid} idle ${cfg.idleTimeoutMinutes} min, 0 players — sleeping`
      );
      instance.println("INFO", `Sleeping: no players for ${cfg.idleTimeoutMinutes} minute(s).`);
      this.emptySince = null;
      instance.execPreset("stop").catch((e) => {
        logger.error(`[sleep] ${instance.instanceUuid} stop failed: ${e?.message ?? e}`);
      });
    }
  }

  async stop(_instance: Instance) {
    if (this.task) clearInterval(this.task);
    this.task = undefined;
    this.emptySince = null;
  }
}
