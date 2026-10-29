// koa-body 8 augments nested Koa 3; preserve the application's Koa 2 contract.
declare module "koa" {
  interface Request {
    body?: any;
    rawBody?: string;
    files?: Record<string, import("formidable").File | import("formidable").File[]>;
  }
}

import { koaBody, HttpMethodEnum } from "koa-body";
import { preCheckMiddleware } from "../middleware/precheck";
import { logger } from "./log";
import Koa from "koa";
import userSystem from "./user_service";
import { configureSecurity } from "./two_factor_service";
import { installSessions, SessionStore } from "./session_store";
export function installAuthentication(
  app: Koa,
  store = new SessionStore((uuid) => userSystem.getInstance(uuid)),
  key?: string
) {
  configureSecurity(store);
  installSessions(app, store, key);
  app.use(preCheckMiddleware);
  app.use(
    koaBody({
      multipart: true,
      parsedMethods: [
        HttpMethodEnum.GET,
        HttpMethodEnum.PUT,
        HttpMethodEnum.POST,
        HttpMethodEnum.DELETE
      ],
      formidable: { maxFileSize: 1024 * 1024 * 500, maxFiles: 1 },
      jsonLimit: "10mb",
      onError(error) {
        logger.error("koaBody Lib Error:", error);
      }
    })
  );
  return store;
}
