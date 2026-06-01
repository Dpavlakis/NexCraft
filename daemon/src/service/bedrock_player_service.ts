import fs from "fs-extra";
import path from "path";
import Instance from "../entity/instance/instance";
import { getServerProperty } from "./mc_motd";

export type BedrockPlayerAction =
  | "kick"
  | "allowlist_add"
  | "allowlist_remove"
  | "allowlist_on"
  | "allowlist_off"
  | "op"
  | "deop";

export interface BedrockAllowEntry {
  name: string;
  xuid?: string;
}

export interface BedrockOperator {
  name?: string;
  xuid: string;
}

export interface BedrockPlayerOverview {
  running: boolean;
  online: string[];
  allowlist: BedrockAllowEntry[];
  allowlistEnabled: boolean;
  operators: BedrockOperator[];
}

const ACTIONS_NO_NAME: BedrockPlayerAction[] = ["allowlist_on", "allowlist_off"];

// Bedrock gamertags may contain spaces; reject control chars / quotes so the
// quoted console command can't be broken out of (command injection guard).
export function assertValidName(name: string): string {
  const n = String(name ?? "").trim();
  if (!n || n.length > 32 || /[\r\n"]/.test(n)) {
    throw new Error("Invalid player name");
  }
  return n;
}

// Parse BDS "list" output, e.g.:
//   There are 2/10 players online:
//   Alice, Bob Builder
export function parseBedrockList(text: string): string[] {
  const idx = text.toLowerCase().indexOf("players online:");
  if (idx < 0) return [];
  const after = text.slice(idx + "players online:".length);
  // Names sit on the rest of that line or the next non-empty line, comma-separated.
  const line =
    after
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0) || "";
  return line
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readJsonArray(file: string): any[] {
  try {
    if (!fs.existsSync(file)) return [];
    const data = fs.readJsonSync(file);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function readAllowlist(instance: Instance): BedrockAllowEntry[] {
  const file = path.join(instance.absoluteCwdPath(), "allowlist.json");
  return readJsonArray(file)
    .map((e) => ({
      name: String(e?.name || ""),
      xuid: e?.xuid ? String(e.xuid) : undefined
    }))
    .filter((e) => e.name);
}

export function readOperators(instance: Instance): BedrockOperator[] {
  const file = path.join(instance.absoluteCwdPath(), "permissions.json");
  const byXuid = new Map<string, string>();
  for (const a of readAllowlist(instance)) if (a.xuid) byXuid.set(a.xuid, a.name);
  return readJsonArray(file)
    .filter((e) => String(e?.permission) === "operator" && e?.xuid)
    .map((e) => {
      const xuid = String(e.xuid);
      return { xuid, name: byXuid.get(xuid) };
    });
}

export function isAllowlistEnabled(instance: Instance): boolean {
  const v =
    getServerProperty(instance, "allow-list") || getServerProperty(instance, "white-list");
  return String(v).trim().toLowerCase() === "true";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Send a command to the BDS console and capture ~settleMs of output.
async function runConsole(instance: Instance, command: string, settleMs = 1000): Promise<string> {
  if (instance.status() !== Instance.STATUS_RUNNING) {
    throw new Error("Server must be running");
  }
  const chunks: string[] = [];
  const listener = (text: any) => chunks.push(String(text));
  instance.on("data", listener);
  try {
    await instance.execPreset("command", command);
    await sleep(settleMs);
  } finally {
    instance.removeListener("data", listener);
  }
  return chunks.join("");
}

export async function getOnlineBedrockPlayers(instance: Instance): Promise<string[]> {
  if (instance.status() !== Instance.STATUS_RUNNING) return [];
  try {
    return parseBedrockList(await runConsole(instance, "list"));
  } catch {
    return [];
  }
}

export async function getBedrockOverview(instance: Instance): Promise<BedrockPlayerOverview> {
  return {
    running: instance.status() === Instance.STATUS_RUNNING,
    online: await getOnlineBedrockPlayers(instance),
    allowlist: readAllowlist(instance),
    allowlistEnabled: isAllowlistEnabled(instance),
    operators: readOperators(instance)
  };
}

export async function bedrockPlayerAction(
  instance: Instance,
  action: BedrockPlayerAction,
  name?: string
): Promise<void> {
  let command: string;
  if (ACTIONS_NO_NAME.includes(action)) {
    command = action === "allowlist_on" ? "allowlist on" : "allowlist off";
  } else {
    const n = assertValidName(String(name));
    switch (action) {
      case "kick":
        command = `kick "${n}"`;
        break;
      case "allowlist_add":
        command = `allowlist add "${n}"`;
        break;
      case "allowlist_remove":
        command = `allowlist remove "${n}"`;
        break;
      case "op":
        command = `op "${n}"`;
        break;
      case "deop":
        command = `deop "${n}"`;
        break;
      default:
        throw new Error("Invalid action");
    }
  }
  await runConsole(instance, command, 300);
}
