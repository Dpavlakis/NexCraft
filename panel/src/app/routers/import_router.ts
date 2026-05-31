import Router from "@koa/router";
import { ROLE } from "../entity/user";
import permission from "../middleware/permission";
import validator from "../middleware/validator";
import { modManagerService } from "../service/mod_manager_service";
import { operationLogger } from "../service/operation_logger";
import RemoteRequest from "../service/remote_command";
import RemoteServiceSubsystem from "../service/remote_service";

const router = new Router({ prefix: "/protected_import" });

// Detect the kind of an existing instance's files (vanilla / loader / modpack)
// by proxying to the daemon's import/detect handler.
router.post(
  "/detect",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String }, body: { instanceUuid: String } }),
  async (ctx) => {
    const daemonId = String(ctx.query.daemonId);
    ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
      "import/detect",
      { instanceUuid: String(ctx.request.body.instanceUuid) }
    );
  }
);

// Best-effort pack identification. This MUST be non-fatal: a failure here just
// means the UI degrades to "Import as-is", so swallow any error and return null
// (200) rather than letting it surface as an HTTP 500.
router.post("/identify", permission({ level: ROLE.ADMIN }), async (ctx) => {
  try {
    ctx.body = await modManagerService.identifyPack(ctx.request.body as any);
  } catch {
    ctx.body = null;
  }
});

// Finalize the import: tell the daemon how to register the existing files as a
// managed instance (kind + optional startCommand / packInfo).
router.post(
  "/finalize",
  permission({ level: ROLE.ADMIN }),
  validator({ query: { daemonId: String }, body: { instanceUuid: String, kind: String } }),
  async (ctx) => {
    const daemonId = String(ctx.query.daemonId);
    operationLogger.log("instance_import", {
      operator_ip: ctx.ip,
      operator_name: ctx.session?.["userName"],
      daemon_id: daemonId,
      kind: String(ctx.request.body.kind)
    });
    ctx.body = await new RemoteRequest(RemoteServiceSubsystem.getInstance(daemonId)).request(
      "import/finalize",
      ctx.request.body
    );
  }
);

export default router;
