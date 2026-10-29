// koa-body 8 ships Koa 3 declarations; retain the Koa 2 request contract.
declare module "koa" {
  interface Request {
    body?: any;
    rawBody?: string;
    files?: Record<string, import("formidable").File | import("formidable").File[]>;
  }
}

import Koa from "koa";
// The package's declarations augment Koa 3 and IncomingMessage.body, which
// conflicts with Koa 2/Express declarations. Keep this compatibility boundary local.
const { koaBody } = require("koa-body") as {
  koaBody(options: {
    multipart: boolean;
    formidable: { maxFileSize: number; maxFiles: number };
    jsonLimit: string;
    onError(error: Error, ctx: Koa.Context): void;
  }): Koa.Middleware;
};
import { removeTrail } from "mcsmanager-common";
import { globalConfiguration } from "../entity/config";
import { uploadFileCheckMiddleware, uploadSpeedLimitMiddleware } from "../middlewares/precheck";
import koaRouter from "../routers/http_router";
import logger from "./log";

export function initKoa() {
  const koaApp = new Koa();
  const config = globalConfiguration.config;
  koaApp.use(uploadSpeedLimitMiddleware);
  koaApp.use(uploadFileCheckMiddleware);
  koaApp.use(
    koaBody({
      multipart: true,
      formidable: {
        maxFileSize: 1024 * 1024 * 100, // 100MB
        maxFiles: 1
      },
      jsonLimit: "10mb",
      onError(err, ctx) {
        logger.error("koaBody Lib Error:", err);
      }
    })
  );
  // Load Koa top-level middleware
  koaApp.use(async (ctx, next) => {
    await next();
    // Because all HTTP requests can only be used by creating a task passport on the panel side, cross-domain requests are allowed, and security can also be guaranteed
    ctx.response.set("Access-Control-Allow-Origin", "*");
    ctx.response.set("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
    ctx.response.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Cookie, Accept-Encoding, User-Agent, Host, Referer, " +
        "X-Requested-With, Accept, Accept-Language, Cache-Control, Connection"
    );
    ctx.response.set("X-Power-by", "MCSManager");
  });

  if (config.prefix != "") {
    const prefix = config.prefix;
    koaApp.use(async (ctx, next) => {
      if (ctx.url.startsWith(prefix)) {
        const orig = ctx.url;
        ctx.url = ctx.url.slice(prefix.length);
        if (!ctx.url.startsWith("/")) {
          ctx.url = "/" + ctx.url;
        }
        await next();
        ctx.url = orig;
      } else {
        ctx.redirect(removeTrail(prefix, "/") + ctx.url);
      }
    });
  }
  koaApp.use(koaRouter.routes()).use(koaRouter.allowedMethods());
  return koaApp;
}
