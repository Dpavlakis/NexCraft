import { $t } from "../../../i18n";
import Instance from "../../instance/instance";
import InstanceCommand from "../base/command";

export default class GeneralStopCommand extends InstanceCommand {
  constructor() {
    super("StopCommand");
  }

  async exec(instance: Instance) {
    const stopCommand = instance.config.stopCommand;
    if (instance.status() === Instance.STATUS_STOP || !instance.process)
      return instance.failure(new Error($t("TXT_CODE_general_stop.notRunning")));

    instance.status(Instance.STATUS_STOPPING);
    instance.ignoreEventTaskOnce();

    const stopCommandList = stopCommand.split("\n");
    for (const stopCommand of stopCommandList) {
      await instance.execPreset("command", stopCommand);
    }

    instance.print("\n");
    instance.println("INFO", $t("TXT_CODE_pty_stop.execCmd", { stopCommand: `\n${stopCommand}` }));

    const cacheStartCount = instance.startCount;

    // Shutdown timeout: if configured, force-kill the process when it fails to stop
    // gracefully within the timeout (Crafty-style "Shutdown Timeout"). 0 = disabled.
    const stopTimeoutSec = Number(instance.config.stopTimeout) || 0;
    if (stopTimeoutSec > 0) {
      setTimeout(() => {
        if (
          instance.status() === Instance.STATUS_STOPPING &&
          instance.startCount === cacheStartCount
        ) {
          instance.println(
            "WARN",
            $t("TXT_CODE_general_stop.stopTimeout", { seconds: stopTimeoutSec })
          );
          instance.execPreset("kill").catch((err) => {
            instance.println("ERROR", String(err));
          });
        }
      }, 1000 * stopTimeoutSec);
    }

    // If the instance is still in the stopped state after 10 minutes, restore the state
    setTimeout(() => {
      if (
        instance.status() === Instance.STATUS_STOPPING &&
        instance.startCount === cacheStartCount
      ) {
        instance.println("ERROR", $t("TXT_CODE_general_stop.stopErr"));
        instance.status(Instance.STATUS_RUNNING);
      }
    }, 1000 * 60 * 10);

    return instance;
  }
}
