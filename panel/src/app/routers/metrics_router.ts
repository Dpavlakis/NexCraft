import Router from "@koa/router";
import { ROLE } from "../entity/user";
import { $t } from "../i18n";
import permission from "../middleware/permission";
import validator from "../middleware/validator";
import { getUserUuid } from "../service/passport_service";
import { isHaveInstanceByUuid } from "../service/permission_service";
import RemoteRequest from "../service/remote_command";
import RemoteServiceSubsystem from "../service/remote_service";

const router = new Router({ prefix: "/protected_metrics" });

router.use(async (ctx, next) => {
  const instanceUuid = String(ctx.query.uuid);
  const daemonId = String(ctx.query.daemonId);
  const userUuid = getUserUuid(ctx);
  if (isHaveInstanceByUuid(userUuid, daemonId, instanceUuid)) {
    await next();
  } else {
    ctx.status = 403;
    ctx.body = $t("TXT_CODE_permission.forbiddenInstance");
  }
});

router.get(
  "/get",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      const since = ctx.query.since ? Number(ctx.query.since) : undefined;
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "metrics/get",
        { instanceUuid, since }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

export default router;
