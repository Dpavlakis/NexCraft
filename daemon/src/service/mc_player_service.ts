import fs from "fs-extra";
import path from "path";
import Rcon from "rcon-srcds";
import Instance from "../entity/instance/instance";
import { $t } from "../i18n";

export type PlayerAction = "kick" | "ban" | "pardon" | "op" | "deop";

const VALID_NAME = /^[A-Za-z0-9_]{1,16}$/;

function readJsonNames(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!Array.isArray(data)) return [];
    return data.map((e: any) => String(e?.name || e?.uuid || "")).filter((n) => n);
  } catch {
    return [];
  }
}

export function readBannedPlayers(instance: Instance): string[] {
  return readJsonNames(path.join(instance.absoluteCwdPath(), "banned-players.json"));
}

export function readOps(instance: Instance): string[] {
  return readJsonNames(path.join(instance.absoluteCwdPath(), "ops.json"));
}

// Run a single RCON command and return its text response.
async function rcon(instance: Instance, command: string): Promise<string> {
  if (!instance.config.rconPort) throw new Error($t("TXT_CODE_player.noRcon"));
  const server = new Rcon({
    host: instance.config.rconIp || "localhost",
    port: instance.config.rconPort,
    encoding: "utf8",
    timeout: 1000 * 6
  });
  try {
    await server.authenticate(instance.config.rconPassword);
    if (!server.isAuthenticated()) throw new Error($t("TXT_CODE_player.rconAuthFailed"));
    return String(await server.execute(command));
  } finally {
    server.disconnect().catch(() => {});
  }
}

// Parse the vanilla/forge "list" output into player names.
function parseListOutput(res: string): string[] {
  const idx = res.toLowerCase().indexOf("online:");
  const tail = idx >= 0 ? res.slice(idx + "online:".length) : res.split(":").slice(1).join(":");
  return tail
    .replace(/[.]+$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => VALID_NAME.test(s));
}

export async function getOnlinePlayers(instance: Instance): Promise<string[]> {
  if (instance.status() !== Instance.STATUS_RUNNING) return [];
  try {
    const res = await rcon(instance, "list");
    return parseListOutput(res);
  } catch {
    return [];
  }
}

export async function getPlayerOverview(instance: Instance) {
  const [online] = await Promise.all([getOnlinePlayers(instance)]);
  return {
    rconReady: !!instance.config.rconPort && instance.config.enableRcon,
    running: instance.status() === Instance.STATUS_RUNNING,
    online,
    banned: readBannedPlayers(instance),
    ops: readOps(instance)
  };
}

export async function playerAction(instance: Instance, action: PlayerAction, name: string) {
  if (!VALID_NAME.test(name)) throw new Error($t("TXT_CODE_player.invalidName"));
  const valid: PlayerAction[] = ["kick", "ban", "pardon", "op", "deop"];
  if (!valid.includes(action)) throw new Error($t("TXT_CODE_player.invalidAction"));
  return await rcon(instance, `${action} ${name}`);
}
