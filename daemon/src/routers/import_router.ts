import fs from "fs-extra";
import path from "path";
import { $t } from "../i18n";
import { routerApp } from "../service/router";
import * as protocol from "../service/protocol";
import InstanceSubsystem from "../service/system_instance";
import { detectServer } from "../service/server_detect";
import { maybeFlatten } from "../service/modpack_files";
import { assignFreeBedrockPort, assignFreeMcPort } from "../service/mc_port";

// Inspect an existing instance's files and guess how the server should run
// (Java vs Bedrock, loader, start command, world name). maybeFlatten first
// collapses a single nested top-level dir (e.g. a Crafty wrapper) so detection
// runs against the real server root.
routerApp.on("import/detect", async (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const dir = inst.absoluteCwdPath();
    await maybeFlatten(dir);
    protocol.response(ctx, detectServer(dir));
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

// Commit an import: stamp the instance type + commands (and optional packInfo),
// accept the EULA for Java, assign a free non-colliding port, and persist.
routerApp.on("import/finalize", async (ctx, data) => {
  try {
    const inst = InstanceSubsystem.getInstance(data.instanceUuid);
    if (!inst) throw new Error($t("TXT_CODE_backup.instanceNotExist"));
    const dir = inst.absoluteCwdPath();
    const kind: "java" | "bedrock" = data.kind === "bedrock" ? "bedrock" : "java";

    if (kind === "java") {
      try {
        fs.writeFileSync(path.join(dir, "eula.txt"), "eula=true\n");
      } catch {
        // non-fatal — user can accept the EULA manually
      }
    }

    // Assign a free port BEFORE persisting the config below. These helpers mutate
    // server.properties + inst.config (rcon/ping) and persist their own changes;
    // the parameters() call below then writes the final, complete config.
    try {
      if (kind === "bedrock") await assignFreeBedrockPort(inst);
      else await assignFreeMcPort(inst);
    } catch {
      // non-fatal — user can set the port manually
    }

    // Persist via the same mechanism the modpack install task uses: parameters()
    // applies the trusted config and StorageSubsystem.store()s it at the end.
    const cfg: any = {
      type: kind === "bedrock" ? "minecraft/bedrock" : "minecraft/java",
      stopCommand: "stop"
    };
    if (typeof data.startCommand === "string" && data.startCommand.trim())
      cfg.startCommand = data.startCommand.trim();
    if (data.packInfo) cfg.packInfo = data.packInfo;
    inst.parameters(cfg, true);

    protocol.response(ctx, { instanceUuid: inst.instanceUuid });
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});
