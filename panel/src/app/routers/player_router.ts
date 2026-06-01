import Router from "@koa/router";
import { ROLE } from "../entity/user";
import { $t } from "../i18n";
import permission from "../middleware/permission";
import validator from "../middleware/validator";
import { getUserUuid } from "../service/passport_service";
import { isHaveInstanceByUuid } from "../service/permission_service";
import RemoteRequest from "../service/remote_command";
import RemoteServiceSubsystem from "../service/remote_service";

const router = new Router({ prefix: "/protected_player" });

// Ownership check
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

// Online players + banned + ops
router.get(
  "/list",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "player/list",
        { instanceUuid }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// kick / ban / pardon / op / deop
router.post(
  "/action",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String }, body: { action: String, name: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "player/action",
        {
          instanceUuid,
          action: ctx.request.body.action,
          name: ctx.request.body.name
        }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Bedrock: overview (online + allowlist + operators)
router.get(
  "/bedrock_overview",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "player/bedrock_overview",
        { instanceUuid }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

// Bedrock: kick / allowlist add|remove|on|off / op | deop
router.post(
  "/bedrock_action",
  permission({ level: ROLE.USER }),
  validator({ query: { daemonId: String, uuid: String }, body: { action: String } }),
  async (ctx) => {
    try {
      const daemonId = String(ctx.query.daemonId);
      const instanceUuid = String(ctx.query.uuid);
      ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
        "player/bedrock_action",
        {
          instanceUuid,
          action: ctx.request.body.action,
          name: ctx.request.body.name
        }
      );
    } catch (err) {
      ctx.body = err;
    }
  }
);

export default router;
