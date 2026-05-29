import path from "path";
import { commandStringToArray } from "../entity/commands/base/command_parser";
import { JavaInfo } from "../entity/commands/java/java_manager";
import { $t } from "../i18n";
import javaManager from "../service/java_manager";
import * as protocol from "../service/protocol";
import { routerApp } from "../service/router";
import FileManager from "../service/system_file";
import instanceManager from "../service/system_instance";

routerApp.on("java_manager/list", async (ctx) => {
  protocol.response(ctx, javaManager.list());
});

routerApp.on("java_manager/add", async (ctx, data) => {
  const info = new JavaInfo(data.name, Date.now());

  try {
    if (!FileManager.checkFileName(data.name)) throw new Error($t("TXT_CODE_b623b66f"));

    if (javaManager.exists(info.fullname)) throw new Error($t("TXT_CODE_79cf0302"));
    info.path = path.normalize(data.path);
    javaManager.addJava(info);
    protocol.response(ctx, true);
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

routerApp.on("java_manager/download", async (ctx, data) => {
  const info = new JavaInfo(data.name, Date.now(), data.version);
  if (javaManager.exists(info.fullname)) {
    return protocol.responseError(ctx, new Error($t("TXT_CODE_79cf0302")));
  }
  protocol.response(ctx, true);

  try {
    await javaManager.downloadAndInstall(info);
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

routerApp.on("java_manager/using", async (ctx, data) => {
  try {
    const instance = instanceManager.getInstance(data.instanceId);
    if (!instance) throw new Error($t("TXT_CODE_ef6b54fb"));

    const startCommandList = commandStringToArray(instance.config.startCommand);
    startCommandList[0] = "{mcsm_java}";
    instance.parameters({
      java: {
        id: data.id
      },
      startCommand: startCommandList.join(" ")
    });

    protocol.response(ctx, true);
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});

routerApp.on("java_manager/delete", async (ctx, data) => {
  try {
    await javaManager.removeJava(data.id);
    protocol.response(ctx, true);
  } catch (error: any) {
    protocol.responseError(ctx, error);
  }
});
