import Koa from "koa";
import bcrypt from "bcryptjs";
import md5 from "md5";
import { randomBytes } from "crypto";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { User, UserPassWordType } from "../entity/user";
import { $t } from "../i18n";
import { credentialFingerprint } from "./security_fingerprint";
import { SecurityError } from "./security_error";
import { liveBrowserUser, sessionStore, SessionStore } from "./session_store";
import userSystem from "./user_service";

type Setup = {
  setupId: string;
  owner: string;
  uuid: string;
  fingerprint: string;
  secret: string;
  expiresAt: number;
  attempts: number;
};
const pending = new Map<string, Setup>();
const budgets = new Map<string, { expires: number; attempts: number }>();
export function configureSecurity(store: SessionStore) {
  userSystem.onSecurityChange = (uuid) => {
    store.revoke(uuid);
    pending.delete(uuid);
  };
  store.onSweep = (now) => {
    for (const [owner, value] of budgets) if (value.expires <= now) budgets.delete(owner);
    // Keep only the bounded owner/ID marker for a precise 410; erase expired secrets.
    for (const setup of pending.values()) if (setup.expiresAt <= now) setup.secret = "";
  };
  store.onDestroy = (owner) => {
    budgets.delete(owner);
    for (const [uuid, setup] of pending) if (setup.owner === owner) pending.delete(uuid);
  };
}
function fail(status: number, message: string): never {
  throw new SecurityError(status, message);
}
export function sensitiveBrowser(ctx: Koa.Context): User {
  if (
    Object.prototype.hasOwnProperty.call(ctx.query, "apikey") ||
    Object.prototype.hasOwnProperty.call(ctx.headers, "x-request-api-key")
  )
    return fail(403, $t("TXT_CODE_permission.forbidden"));
  const user = liveBrowserUser(ctx);
  if (
    !user ||
    ctx.get("x-requested-with").toLowerCase() !== "xmlhttprequest" ||
    typeof ctx.query.token !== "string" ||
    !ctx.query.token ||
    ctx.query.token !== ctx.session?.token
  )
    return fail(403, $t("TXT_CODE_permission.forbidden"));
  return user;
}
export async function sensitivePermission(ctx: Koa.Context, next: () => Promise<any>) {
  sensitiveBrowser(ctx);
  await next();
}
export function bodyShape(value: any, allowed: string[]): Record<string, any> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    return fail(400, "Invalid security request");
  return value;
}
function proofShape(body: Record<string, any>) {
  if (
    body.currentPassword !== undefined &&
    (typeof body.currentPassword !== "string" ||
      !body.currentPassword.length ||
      body.currentPassword.length > 256)
  )
    fail(400, "Invalid current password");
  if (
    body.currentTOTP !== undefined &&
    (typeof body.currentTOTP !== "string" || !/^\d{6}$/.test(body.currentTOTP))
  )
    fail(400, "Invalid current authenticator code");
}
function setupId(value: any): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    return fail(400, "Invalid setup ID");
  return value;
}
export function passwordMatches(user: User, password: string): boolean {
  return user.passWordType === UserPassWordType.bcrypt
    ? bcrypt.compareSync(password, user.passWord)
    : md5(password) === user.passWord;
}
export function factorMatches(secret: string, code: string): boolean {
  return !!secret && /^\d{6}$/.test(code) && authenticator.clone({ window: 0 }).check(code, secret);
}
function budget(ctx: Koa.Context) {
  const store = sessionStore(ctx),
    now = store.now(),
    owner = store.identity(ctx);
  for (const [key, value] of budgets) if (value.expires <= now) budgets.delete(key);
  let value = budgets.get(owner);
  if (!value) {
    if (budgets.size >= 2048) fail(503, "Security operation capacity reached");
    value = { expires: now + 300000, attempts: 0 };
    budgets.set(owner, value);
  }
  if (value.attempts >= 5) fail(429, "Too many proof attempts; retry later");
  value.attempts++;
}
function currentProof(ctx: Koa.Context, user: User, body: Record<string, any>, localOnly = false) {
  proofShape(body);
  budget(ctx);
  const passwordOK =
    typeof body.currentPassword === "string" && passwordMatches(user, body.currentPassword);
  if (!passwordOK && (localOnly || !sessionStore(ctx).recentProvider(ctx)))
    fail(403, $t("TXT_CODE_permission.forbidden"));
  if (user.open2FA && (!body.currentTOTP || !factorMatches(user.secret, body.currentTOTP)))
    fail(403, $t("TXT_CODE_permission.forbidden"));
}
function lockedUser(ctx: Koa.Context, user: User) {
  if (sensitiveBrowser(ctx).uuid !== user.uuid) fail(403, "Session expired; sign in again");
  sessionStore(ctx).checkpoint(ctx);
}
export async function changePassword(ctx: Koa.Context, input: any) {
  const body = bodyShape(input, ["passWord", "currentPassword", "currentTOTP", "isInit"]);
  if (
    typeof body.passWord !== "string" ||
    !userSystem.validatePassword(body.passWord) ||
    (body.isInit !== undefined && typeof body.isInit !== "boolean")
  )
    fail(400, $t("TXT_CODE_router.user.passwordCheck"));
  const uuid = sensitiveBrowser(ctx).uuid;
  await userSystem.withUser(uuid, async (user, save) => {
    lockedUser(ctx, user);
    currentProof(ctx, user, body, true);
    await save({ passWord: body.passWord, isInit: body.isInit });
    sessionStore(ctx).logout(ctx);
  });
  return true;
}
export async function changeApiKey(ctx: Koa.Context, input: any) {
  const body = bodyShape(input, ["enable", "currentPassword", "currentTOTP"]);
  if (typeof body.enable !== "boolean") fail(400, "Invalid enable flag");
  return userSystem.withUser(sensitiveBrowser(ctx).uuid, async (user, save) => {
    lockedUser(ctx, user);
    currentProof(ctx, user, body);
    const apiKey = body.enable ? randomBytes(16).toString("hex") : "";
    await save({ apiKey });
    return apiKey;
  });
}
export async function startFactor(ctx: Koa.Context, input: any) {
  const body = bodyShape(input, ["currentPassword", "currentTOTP"]);
  return userSystem.withUser(sensitiveBrowser(ctx).uuid, async (user) => {
    lockedUser(ctx, user);
    currentProof(ctx, user, body);
    const store = sessionStore(ctx),
      owner = store.identity(ctx);
    const secret = authenticator.generateSecret();
    let qrcode: string;
    try {
      qrcode = await QRCode.toDataURL(authenticator.keyuri(user.userName, "NexCraft", secret));
    } catch {
      return fail(503, "Authenticator setup unavailable");
    }
    lockedUser(ctx, user); // logout/revocation may occur during QR generation
    const now = store.now();
    store.onSweep(now);
    if (!pending.has(user.uuid) && pending.size >= 2048)
      fail(503, "Authenticator setup capacity reached");
    const setup: Setup = {
      setupId: randomBytes(32).toString("hex"),
      secret,
      owner,
      uuid: user.uuid,
      fingerprint: credentialFingerprint(user),
      expiresAt: now + 300000,
      attempts: 0
    };
    pending.set(user.uuid, setup);
    ctx.set("Cache-Control", "no-store");
    return { setupId: setup.setupId, qrcode, expiresAt: setup.expiresAt, replacing: user.open2FA };
  });
}
export async function confirmFactor(ctx: Koa.Context, input: any) {
  if (typeof input?.enable !== "boolean") fail(400, "Invalid enable flag");
  const body = bodyShape(
    input,
    input.enable ? ["enable", "setupId", "TOTPCode"] : ["enable", "currentPassword", "currentTOTP"]
  );
  if (body.enable && (typeof body.TOTPCode !== "string" || !/^\d{6}$/.test(body.TOTPCode)))
    fail(400, "Invalid new authenticator code");
  if (body.enable) setupId(body.setupId);
  return userSystem.withUser(sensitiveBrowser(ctx).uuid, async (user, save) => {
    lockedUser(ctx, user);
    if (body.enable) {
      const setup = pending.get(user.uuid);
      if (
        !setup ||
        setup.setupId !== body.setupId ||
        setup.owner !== sessionStore(ctx).identity(ctx) ||
        setup.fingerprint !== credentialFingerprint(user)
      )
        fail(409, "Authenticator setup changed");
      if (setup.expiresAt <= sessionStore(ctx).now()) {
        pending.delete(user.uuid);
        fail(410, "Authenticator setup expired");
      }
      if (setup.attempts >= 5) fail(429, "Too many confirmation attempts");
      if (!factorMatches(setup.secret, body.TOTPCode)) {
        setup.attempts++;
        fail(403, $t("TXT_CODE_permission.forbidden"));
      }
      await save({ secret: setup.secret, open2FA: true });
    } else {
      currentProof(ctx, user, body);
      if (!user.open2FA || !user.secret || !body.currentTOTP)
        fail(403, $t("TXT_CODE_permission.forbidden"));
      await save({ secret: "", open2FA: false });
    }
    pending.delete(user.uuid);
    sessionStore(ctx).logout(ctx);
    return { enabled: body.enable, reloginRequired: true };
  });
}
export async function cancelFactor(ctx: Koa.Context, input: any) {
  const body = bodyShape(input, ["setupId"]);
  setupId(body.setupId);
  return userSystem.withUser(sensitiveBrowser(ctx).uuid, async (user) => {
    lockedUser(ctx, user);
    const setup = pending.get(user.uuid);
    if (
      setup &&
      (setup.setupId !== body.setupId || setup.owner !== sessionStore(ctx).identity(ctx))
    )
      fail(409, "Authenticator setup changed");
    pending.delete(user.uuid);
    return true;
  });
}
