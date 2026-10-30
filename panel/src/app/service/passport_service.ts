import Koa from "koa";
import { GlobalVariable } from "mcsmanager-common";
import { liveBrowserUser, sessionStore } from "./session_store";

import { User } from "../entity/user";
import { $t } from "../i18n";
import { systemConfig } from "../setting";
import { logger } from "./log";
import userSystem from "./user_service";

export const BAN_IP_COUNT = "banip";
export const LOGIN_FAILED_KEY = "loginFailed";
export const ILLEGAL_ACCESS_KEY = "illegalAccess";
export const LOGIN_COUNT = "loginCount";
export const LOGIN_FAILED_COUNT_KEY = "loginFailedCount";

export async function login(
  ctx: Koa.ParameterizedContext,
  userName: string,
  passWord: string,
  twoFACode?: string
): Promise<string> {
  // record the number of login requests
  GlobalVariable.set(LOGIN_COUNT, GlobalVariable.get(LOGIN_COUNT, 0) + 1);
  const ip = getLoginIp(ctx);
  // check user information
  try {
    // Lookup is only a reload hint. Authentication below always uses committed state.
    const candidate = Array.from(userSystem.objects.values()).find(
      (user) => user.userName === userName
    );
    if (candidate) await userSystem.recoverAuthentication(candidate.uuid);
    const totpDriftToleranceSteps = systemConfig?.totpDriftToleranceSteps || 0;
    userSystem.checkUser({ userName, passWord }, twoFACode, totpDriftToleranceSteps);
    // The number of errors to reset this IP after successful login
    const ipMap = GlobalVariable.get(LOGIN_FAILED_KEY);
    if (ipMap) delete ipMap[ip || ""];

    // Session Session state changes to logged in
    return loginSuccess(ctx, userName);
  } catch (err) {
    // record the number of login failures
    GlobalVariable.set(LOGIN_FAILED_COUNT_KEY, GlobalVariable.get(LOGIN_FAILED_COUNT_KEY, 0) + 1);
    if (ctx.session) {
      ctx.session["login"] = null;
      ctx.session["token"] = null;
    }
    logger.info(`[LOGIN] IP: ${ip}, Try login ${userName} failed!`);
    throw err;
  }
}

export function loginSuccess(
  ctx: Koa.ParameterizedContext,
  userName: string,
  verifiedProviderAt?: number
) {
  const ip = getLoginIp(ctx);
  const user = userSystem.getUserByUserName(userName);
  if (!user) throw new Error($t("TXT_CODE_router.login.nameOrPassError"));
  if (!ctx.session) throw new Error("Session is Null!");

  user.loginTime = new Date().toLocaleString();
  const token = sessionStore(ctx).issue(ctx, user, verifiedProviderAt);

  logger.info($t("TXT_CODE_42036f92"));
  logger.info(`[LOGIN] IP: ${ip} Login ${userName} successful!`);
  logger.info($t("TXT_CODE_42036f92"));

  return token;
}

export function getLoginIp(ctx: Koa.ParameterizedContext) {
  return ctx.ip ?? "";
}

export function check(ctx: Koa.ParameterizedContext) {
  return !!liveBrowserUser(ctx);
}

export async function logout(ctx: Koa.ParameterizedContext): Promise<boolean> {
  // Revocation must never wait for account persistence. Already authorized writes
  // may finish, but queued work revalidates and late saves cannot recreate this entry.
  sessionStore(ctx).logout(ctx);
  return true;
}

export async function register(
  ctx: Koa.ParameterizedContext,
  userName: string,
  passWord: string,
  permission: number
) {
  let f = true;
  // Check for duplicate usernames.
  userSystem.objects.forEach((user) => {
    if (user && user.userName == userName) f = false;
  });
  if (f) {
    // Next. UUID and other data will be automatically generated.
    const { uuid } = await userSystem.create({
      userName,
      passWord,
      permission
    });

    return {
      uuid,
      userName,
      permission
    };
  }
  return false;
}

export function getUserPermission(ctx: Koa.ParameterizedContext): number {
  let user: User | undefined | null = undefined;
  if (isApiRequest(ctx)) {
    user = getUuidByApiKey(getApiKey(ctx));
  } else {
    user = liveBrowserUser(ctx);
  }
  if (!user) return 0;
  return user.permission ?? 0;
}

export function getUserNameBySession(ctx: Koa.ParameterizedContext): string {
  if (isApiRequest(ctx)) {
    const user = getUuidByApiKey(getApiKey(ctx));
    return user ? user.userName : "";
  }
  return liveBrowserUser(ctx)?.userName || "";
}

export function getUserFromCtx(ctx: Koa.ParameterizedContext) {
  try {
    if (isApiRequest(ctx)) {
      const user = getUuidByApiKey(getApiKey(ctx));
      return user || undefined;
    }
    return liveBrowserUser(ctx);
  } catch (error) {
    return undefined;
  }
}

export function getUserUuid(ctx: Koa.ParameterizedContext): string {
  if (isApiRequest(ctx)) {
    const user = getUuidByApiKey(getApiKey(ctx));
    if (user && user.uuid) {
      return user.uuid;
    } else {
      return "";
    }
  }
  return liveBrowserUser(ctx)?.uuid || "";
}

export function getToken(ctx: Koa.ParameterizedContext): string {
  return liveBrowserUser(ctx) ? ctx.session?.token || "" : "";
}

export function isAjax(ctx: Koa.ParameterizedContext) {
  return (
    ctx.header["x-requested-with"] &&
    ctx.header["x-requested-with"].toString().toLocaleLowerCase() === "xmlhttprequest"
  );
}

export function checkBanIp(ctx: Koa.ParameterizedContext) {
  if (!GlobalVariable.map.has(LOGIN_FAILED_KEY)) GlobalVariable.set(LOGIN_FAILED_KEY, {});
  // This IpMap also needs to be used when logging in
  const ipMap = GlobalVariable.get(LOGIN_FAILED_KEY);

  const ip = getLoginIp(ctx);

  if (ipMap[ip] > 10 && systemConfig?.loginCheckIp === true) {
    if (ipMap[ip] != 999) {
      // record the number of bans
      GlobalVariable.set(BAN_IP_COUNT, GlobalVariable.get(BAN_IP_COUNT, 0) + 1);
      setTimeout(
        () => {
          delete ipMap[ip];
          // delete the number of bans
          GlobalVariable.set(BAN_IP_COUNT, GlobalVariable.get(BAN_IP_COUNT, 1) - 1);
        },
        1000 * 60 * 10
      );
    }
    ipMap[ip] = 999;
    return false;
  }
  if (!isNaN(Number(ipMap[ip]))) ipMap[ip] = Number(ipMap[ip]) + 1;
  else ipMap[ip] = 1;
  return true;
}

export function getUuidByApiKey(apiKey: string) {
  const pageData = userSystem.getQueryWrapper().selectPage(
    {
      apiKey
    },
    1,
    1
  );
  if (pageData.total === 1) {
    return pageData.data[0];
  }
  return null;
}

export function isApiRequest(ctx: Koa.ParameterizedContext) {
  return ctx.query.apikey || ctx.request?.header["x-request-api-key"] ? true : false;
}

export function getApiKey(ctx: Koa.ParameterizedContext) {
  return String(ctx.query.apikey || ctx.request?.header["x-request-api-key"] || "");
}
