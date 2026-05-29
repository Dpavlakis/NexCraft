import { $t } from "../i18n";
import { getPlayerOverview, playerAction, type PlayerAction } from "../service/mc_player_service";
import * as protocol from "../service/protocol";
import { routerApp } from "../service/router";
import InstanceSubsystem from "../service/system_instance";

// Online players (via RCON) + banned + ops
routerApp.on("player/list", async (ctx, data) => {
  try {
    const instance = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!instance) throw new Error($t("TXT_CODE_player.instanceNotExist"));
    protocol.response(ctx, await getPlayerOverview(instance));
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// kick / ban / pardon / op / deop a player
routerApp.on("player/action", async (ctx, data) => {
  try {
    const instance = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!instance) throw new Error($t("TXT_CODE_player.instanceNotExist"));
    const result = await playerAction(instance, data.action as PlayerAction, String(data.name));
    protocol.response(ctx, { result });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});
