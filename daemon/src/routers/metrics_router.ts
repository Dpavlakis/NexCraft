import { $t } from "../i18n";
import metricsService from "../service/metrics_service";
import * as protocol from "../service/protocol";
import { routerApp } from "../service/router";
import InstanceSubsystem from "../service/system_instance";

// Time-series metrics (cpu/mem/players) for an instance
routerApp.on("metrics/get", (ctx, data) => {
  try {
    const instance = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!instance) throw new Error($t("TXT_CODE_player.instanceNotExist"));
    const since = data.since ? Number(data.since) : undefined;
    protocol.response(ctx, metricsService.getMetrics(data.instanceUuid, since));
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});
