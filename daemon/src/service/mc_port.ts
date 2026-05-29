import { randomBytes } from "crypto";
import dgram from "dgram";
import fs from "fs-extra";
import net from "net";
import path from "path";
import StorageSubsystem from "../common/system_storage";
import type Instance from "../entity/instance/instance";
import InstanceSubsystem from "./system_instance";

// server-portv6 is Bedrock's IPv6 UDP port; include it so it's counted as used.
const PORT_KEYS = ["server-port", "query.port", "rcon.port", "server-portv6"];

function readPortsFromProps(file: string): number[] {
  if (!fs.existsSync(file)) return [];
  let txt = "";
  try {
    txt = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const ports: number[] = [];
  for (const key of PORT_KEYS) {
    const m = txt.match(new RegExp(`^${key.replace(/\./g, "\\.")}\\s*=\\s*(\\d+)`, "m"));
    if (m) ports.push(Number(m[1]));
  }
  return ports;
}

// Collect server-port/query.port values configured across all other instances.
export function getUsedMcPorts(excludeUuid?: string): Set<number> {
  const used = new Set<number>();
  for (const instance of InstanceSubsystem.instances.values()) {
    if (excludeUuid && instance.instanceUuid === excludeUuid) continue;
    try {
      for (const p of readPortsFromProps(path.join(instance.absoluteCwdPath(), "server.properties"))) {
        used.add(p);
      }
    } catch {
      // instance with no cwd yet — skip
    }
  }
  return used;
}

function isPortFreeOnOs(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "0.0.0.0");
  });
}

// Find the first free port at/after `start`, skipping ports used by other instances.
export async function findFreeMcPort(start = 25565, exclude?: Set<number>): Promise<number> {
  const used = exclude ?? getUsedMcPorts();
  for (let p = start; p < start + 2000; p++) {
    if (used.has(p)) continue;
    if (await isPortFreeOnOs(p)) return p;
  }
  return start;
}

function upsertProp(txt: string, key: string, value: string): string {
  const re = new RegExp(`^${key.replace(/\./g, "\\.")}\\s*=.*$`, "m");
  if (re.test(txt)) return txt.replace(re, `${key}=${value}`);
  const prefix = txt && !txt.endsWith("\n") ? txt + "\n" : txt;
  return `${prefix}${key}=${value}\n`;
}

// Check whether a UDP port is free on the host (Bedrock uses UDP).
function isUdpPortFreeOnOs(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    sock.once("error", () => resolve(false));
    sock.once("listening", () => sock.close(() => resolve(true)));
    sock.bind(port, "0.0.0.0");
  });
}

// Assign a free Bedrock port pair (IPv4 `server-port` + IPv6 `server-portv6`)
// starting at 19132, skipping ports used by other instances. Bedrock is UDP, so
// we OS-check via dgram. Returns the chosen IPv4 port.
export async function assignFreeBedrockPort(instance: Instance): Promise<number> {
  const used = getUsedMcPorts(instance.instanceUuid);
  let port = 19132;
  for (let p = 19132; p < 19132 + 2000; p += 2) {
    if (used.has(p) || used.has(p + 1)) continue;
    if (await isUdpPortFreeOnOs(p)) {
      port = p;
      break;
    }
  }
  used.add(port);
  used.add(port + 1);

  const file = path.join(instance.absoluteCwdPath(), "server.properties");
  let txt = "";
  if (fs.existsSync(file)) {
    try {
      txt = fs.readFileSync(file, "utf-8");
    } catch {
      txt = "";
    }
  }
  txt = upsertProp(txt, "server-port", String(port));
  txt = upsertProp(txt, "server-portv6", String(port + 1));
  fs.writeFileSync(file, txt);

  try {
    if (instance.config.pingConfig) instance.config.pingConfig.port = port;
    StorageSubsystem.store("InstanceConfig", instance.instanceUuid, instance.config);
  } catch {
    // ignore
  }
  return port;
}

// Assign a free port to an instance by writing server-port + query.port into
// server.properties (creating the file if Minecraft hasn't generated it yet).
// Returns the chosen port.
export async function assignFreeMcPort(instance: Instance): Promise<number> {
  const used = getUsedMcPorts(instance.instanceUuid);
  const port = await findFreeMcPort(25565, used);
  used.add(port);
  // Distinct free port for RCON (default base 25575)
  const rconPort = await findFreeMcPort(25575, used);
  const rconPassword = randomBytes(12).toString("hex");

  const file = path.join(instance.absoluteCwdPath(), "server.properties");
  let txt = "";
  if (fs.existsSync(file)) {
    try {
      txt = fs.readFileSync(file, "utf-8");
    } catch {
      txt = "";
    }
  }
  txt = upsertProp(txt, "server-port", String(port));
  txt = upsertProp(txt, "query.port", String(port));
  txt = upsertProp(txt, "enable-query", "true");
  // Enable RCON so the player manager can list/kick/ban/op players
  txt = upsertProp(txt, "enable-rcon", "true");
  txt = upsertProp(txt, "rcon.port", String(rconPort));
  txt = upsertProp(txt, "rcon.password", rconPassword);
  fs.writeFileSync(file, txt);

  // Persist the matching settings on the instance config
  try {
    if (instance.config.pingConfig) instance.config.pingConfig.port = port;
    instance.config.enableRcon = true;
    instance.config.rconPort = rconPort;
    instance.config.rconPassword = rconPassword;
    instance.config.rconIp = instance.config.rconIp || "";
    StorageSubsystem.store("InstanceConfig", instance.instanceUuid, instance.config);
  } catch {
    // ignore
  }
  return port;
}
