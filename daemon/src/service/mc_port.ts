import fs from "fs-extra";
import net from "net";
import path from "path";
import type Instance from "../entity/instance/instance";
import InstanceSubsystem from "./system_instance";

const PORT_KEYS = ["server-port", "query.port"];

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

// Assign a free port to an instance by writing server-port + query.port into
// server.properties (creating the file if Minecraft hasn't generated it yet).
// Returns the chosen port.
export async function assignFreeMcPort(instance: Instance): Promise<number> {
  const used = getUsedMcPorts(instance.instanceUuid);
  const port = await findFreeMcPort(25565, used);
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
  fs.writeFileSync(file, txt);

  // Keep the MCSManager status ping pointed at the right port too
  try {
    if (instance.config.pingConfig) instance.config.pingConfig.port = port;
  } catch {
    // ignore
  }
  return port;
}
