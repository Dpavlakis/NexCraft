import { randomBytes } from "crypto";
import { Mutex } from "async-mutex";
import dgram from "dgram";
import fs from "fs-extra";
import net from "net";
import StorageSubsystem from "../common/system_storage";
import type Instance from "../entity/instance/instance";
import { assertSafePath } from "../utils/safe_path";
import InstanceSubsystem from "./system_instance";

const allocationMutex = new Mutex();
const reservations = new Map<string, NetworkSnapshot>();
export function releaseMcNetwork(instance: Instance) {
  reservations.delete(instance.instanceUuid);
}
const PORT_KEYS = ["server-port", "query.port", "rcon.port", "server-portv6"];
const NETWORK_KEYS = [...PORT_KEYS, "enable-query", "enable-rcon", "rcon.password"];
export type NetworkSnapshot = Record<string, string>;

export function validateGamePort(value: unknown, bedrock = false): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > (bedrock ? 65534 : 65535)
  )
    throw new Error(`Game port must be an integer from 1 to ${bedrock ? 65534 : 65535}.`);
  return value;
}

// O_NOFOLLOW protects the leaf at open time on Linux/Node 20. assertSafePath also
// rejects linked roots/parents and provides the Windows junction/leaf check.
// Directory replacement by a local process remains outside this point-in-time check.
const noFollow = fs.constants.O_NOFOLLOW || 0;
const MAX_PROPERTIES_BYTES = 128 * 1024;
function readBoundedProperties(fd: number): string {
  const stat = fs.fstatSync(fd);
  if (!stat.isFile()) throw new Error("server.properties must be a regular file.");
  if (stat.size > MAX_PROPERTIES_BYTES) throw new Error("server.properties exceeds 128 KiB.");
  // Read one sentinel byte beyond the cap to detect growth after fstat.
  const bytes = Buffer.alloc(MAX_PROPERTIES_BYTES + 1);
  let count = 0;
  while (count < bytes.length) {
    const read = fs.readSync(fd, bytes, count, bytes.length - count, count);
    if (read === 0) break;
    count += read;
    if (count > MAX_PROPERTIES_BYTES) throw new Error("server.properties exceeds 128 KiB.");
  }
  return bytes.subarray(0, count).toString("utf8");
}
function readProperties(instance: Instance): string {
  const file = assertSafePath(instance.absoluteCwdPath(), "server.properties");
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow | (fs.constants.O_NONBLOCK || 0));
  } catch (error: any) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
  try {
    return readBoundedProperties(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function properties(instance: Instance): NetworkSnapshot {
  const result: NetworkSnapshot = {};
  for (const line of readProperties(instance).split(/\r?\n/)) {
    const match = line.match(/^\s*([^#!\s=]+)\s*=\s*(.*)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}
export function snapshotMcNetwork(
  instance: Instance,
  bedrock = instance.config.type === "minecraft/bedrock"
): NetworkSnapshot | undefined {
  const props = properties(instance);
  if (!props["server-port"]) {
    if (PORT_KEYS.some((key) => props[key] !== undefined))
      throw new Error("Configured network settings have no valid server-port.");
    return undefined;
  }
  const result = Object.fromEntries(
    NETWORK_KEYS.filter((key) => props[key] !== undefined).map((key) => [key, props[key]])
  );
  if (!bedrock) {
    result["enable-query"] ??= "false";
    result["enable-rcon"] ??= "false";
    result["rcon.port"] ??= "25575";
    result["rcon.password"] ??= instance.config.rconPassword || "";
    result["query.port"] ??= "25565";
  }
  return result;
}
function addPort(used: Set<number>, raw: unknown) {
  if (
    (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))) &&
    Number.isInteger(Number(raw)) &&
    Number(raw) >= 1 &&
    Number(raw) <= 65535
  )
    used.add(Number(raw));
}
export function getUsedMcPorts(excludeUuid?: string): Set<number> {
  const used = new Set<number>();
  for (const instance of InstanceSubsystem.instances.values()) {
    if (instance.instanceUuid === excludeUuid) continue;
    let values: NetworkSnapshot = {};
    try {
      values = properties(instance);
    } catch {
      // One orphaned/unreadable OTHER instance must not block every install.
      // Keep its last persisted ports reserved; owned reads/writes remain strict.
    }
    for (const key of PORT_KEYS) addPort(used, values[key]);
    if (!values["server-port"]) {
      const game = instance.config.pingConfig?.port;
      addPort(used, game);
      if (instance.config.type === "minecraft/bedrock" && typeof game === "number")
        addPort(used, game + 1);
      addPort(used, instance.config.basePort);
    }
    if (!values["rcon.port"]) addPort(used, instance.config.rconPort);
  }
  for (const [uuid, values] of reservations) {
    if (uuid !== excludeUuid) for (const key of PORT_KEYS) addPort(used, values[key]);
  }
  return used;
}

type Endpoint = { port: number; protocol: "tcp" | "udp" | "udp4" | "udp6" };
const ipv6Unavailable = (error: NodeJS.ErrnoException) =>
  error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL";
function probe(port: number, tcp: boolean, ipv6: boolean): Promise<boolean | "no-ipv6"> {
  return new Promise((resolve, reject) => {
    let socket: net.Server | dgram.Socket;
    const failed = (error: NodeJS.ErrnoException) => {
      // Failed bind/listen sockets also need closing. close may throw when the
      // handle was never opened (or TCP may callback ERR_SERVER_NOT_RUNNING).
      try {
        socket?.close();
      } catch {}
      if (ipv6 && ipv6Unavailable(error)) resolve("no-ipv6");
      else if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    };
    try {
      socket = tcp
        ? net.createServer()
        : dgram.createSocket({ type: ipv6 ? "udp6" : "udp4", ipv6Only: ipv6 });
      socket.once("error", failed);
      socket.once("listening", () => socket.close(() => resolve(true)));
      const host = ipv6 ? "::" : "0.0.0.0";
      if (tcp) (socket as net.Server).listen({ port, host, ipv6Only: ipv6 });
      else (socket as dgram.Socket).bind(port, host);
    } catch (error: any) {
      failed(error);
    }
  });
}
async function isFree(endpoint: Endpoint): Promise<boolean> {
  if (endpoint.protocol === "udp4") return (await probe(endpoint.port, false, false)) === true;
  const v6 = await probe(endpoint.port, endpoint.protocol === "tcp", true);
  if (v6 === false) return false;
  // Java TCP/query must check both families even on v6-only hosts. Bedrock's v6
  // paired port is checked on IPv4 only when IPv6 is actually unavailable.
  if (endpoint.protocol === "tcp" || endpoint.protocol === "udp" || v6 === "no-ipv6")
    return (await probe(endpoint.port, endpoint.protocol === "tcp", false)) === true;
  return true;
}
async function available(endpoints: Endpoint[], used: Set<number>, skipOs = false) {
  for (const endpoint of endpoints) {
    if (used.has(endpoint.port) || (!skipOs && !(await isFree(endpoint)))) return false;
  }
  return true;
}
export async function findFreeMcPort(start = 25565, exclude?: Set<number>): Promise<number> {
  validateGamePort(start);
  const used = exclude ?? getUsedMcPorts();
  for (let port = start; port <= Math.min(65535, start + 1999); port++)
    if (await available([{ port, protocol: "tcp" }], used)) return port;
  throw new Error("No available Minecraft ports in the allocation range.");
}
function upsert(txt: string, key: string, value: string) {
  const re = new RegExp(`^[ \\t]*${key.replace(/\./g, "\\.")}[ \\t]*=[^\\r\\n]*`, "gm");
  if (re.test(txt)) return txt.replace(re, () => `${key}=${value}`);
  return `${txt}${txt && !txt.endsWith("\n") ? "\n" : ""}${key}=${value}\n`;
}
function persist(instance: Instance, values: NetworkSnapshot) {
  const root = instance.absoluteCwdPath();
  assertSafePath(root, "server.properties");
  fs.ensureDirSync(root);
  const file = assertSafePath(root, "server.properties");
  // Do not truncate before the no-follow open and regular-file check succeed.
  const fd = fs.openSync(
    file,
    fs.constants.O_RDWR | fs.constants.O_CREAT | noFollow | (fs.constants.O_NONBLOCK || 0),
    0o600
  );
  try {
    let txt = readBoundedProperties(fd);
    for (const [key, value] of Object.entries(values)) txt = upsert(txt, key, value);
    fs.ftruncateSync(fd, 0);
    const bytes = Buffer.from(txt, "utf8");
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
      if (written === 0) throw new Error("Could not persist Minecraft network settings.");
      offset += written;
    }
  } finally {
    fs.closeSync(fd);
  }
  instance.config.pingConfig = {
    ...instance.config.pingConfig,
    port: Number(values["server-port"])
  };
  if (values["rcon.port"] !== undefined) instance.config.rconPort = Number(values["rcon.port"]);
  if (values["rcon.password"] !== undefined) instance.config.rconPassword = values["rcon.password"];
  if (values["enable-rcon"] !== undefined)
    instance.config.enableRcon = values["enable-rcon"] === "true";
  StorageSubsystem.store("InstanceConfig", instance.instanceUuid, instance.config);
}
function endpoints(values: NetworkSnapshot, bedrock: boolean): Endpoint[] {
  const port = (key: string) => {
    if (!/^\d+$/.test(values[key] || "")) throw new Error(`Invalid preserved ${key}.`);
    return validateGamePort(Number(values[key]))!;
  };
  if (bedrock)
    return [
      { port: port("server-port"), protocol: "udp4" },
      { port: port("server-portv6"), protocol: "udp6" }
    ];
  const game = port("server-port");
  const result: Endpoint[] = [{ port: game, protocol: "tcp" }];
  if (values["enable-query"] === "true") result.push({ port: port("query.port"), protocol: "udp" });
  if (values["enable-rcon"] === "true") {
    const rcon = port("rcon.port");
    if (rcon === game) throw new Error("RCON port must differ from the game port.");
    result.push({ port: rcon, protocol: "tcp" });
  }
  return result;
}
export async function validatePreservedMcNetwork(
  instance: Instance,
  values: NetworkSnapshot,
  bedrock: boolean,
  skipOs = false
) {
  const used = getUsedMcPorts(instance.instanceUuid);
  for (const key of PORT_KEYS) {
    if (
      values[key] !== undefined &&
      (!/^\d+$/.test(values[key]) || used.has(validateGamePort(Number(values[key]))!))
    )
      throw new Error("A preserved Minecraft port is invalid or already in use.");
  }
  if (!(await available(endpoints(values, bedrock), used, skipOs)))
    throw new Error("A preserved Minecraft port is already in use.");
}
export async function reservePreservedMcNetwork(
  instance: Instance,
  values: NetworkSnapshot,
  bedrock: boolean,
  skipOs = false
) {
  await allocationMutex.runExclusive(async () => {
    await validatePreservedMcNetwork(instance, values, bedrock, skipOs);
    reservations.set(instance.instanceUuid, { ...values });
  });
}
// Recovery writes the already-reserved snapshot even if a failed archive install
// clobbered properties. Never release that reservation if recovery itself fails.
export async function restoreReservedMcNetwork(instance: Instance, values: NetworkSnapshot) {
  await allocationMutex.runExclusive(() => {
    if (!reservations.has(instance.instanceUuid))
      throw new Error("Network settings are not reserved.");
    persist(instance, values);
  });
}
async function assign(
  instance: Instance,
  bedrock: boolean,
  requested?: number,
  preserved?: NetworkSnapshot,
  reserve = false
): Promise<number> {
  requested = validateGamePort(requested, bedrock);
  return allocationMutex.runExclusive(async () => {
    const used = getUsedMcPorts(instance.instanceUuid);
    if (preserved) {
      await validatePreservedMcNetwork(instance, preserved, bedrock);
      persist(instance, preserved);
      if (reserve || reservations.has(instance.instanceUuid))
        reservations.set(instance.instanceUuid, { ...preserved });
      return Number(preserved["server-port"]);
    }
    let selected: number | undefined;
    const start = bedrock ? 19132 : 25565;
    for (
      let port = requested ?? start;
      port <= (requested ?? Math.min(bedrock ? 65534 : 65535, start + 1999));
      port += bedrock && requested === undefined ? 2 : 1
    ) {
      const checks: Endpoint[] = bedrock
        ? [
            { port, protocol: "udp4" },
            { port: port + 1, protocol: "udp6" }
          ]
        : [
            { port, protocol: "tcp" },
            { port, protocol: "udp" }
          ];
      if (await available(checks, used)) {
        selected = port;
        break;
      }
    }
    if (selected === undefined)
      throw new Error(
        requested === undefined
          ? "No available Minecraft ports in the allocation range."
          : "Requested game port is already in use."
      );
    const values: NetworkSnapshot = { "server-port": String(selected) };
    if (bedrock) values["server-portv6"] = String(selected + 1);
    else {
      used.add(selected);
      values["query.port"] = String(selected);
      values["enable-query"] = "true";
      values["rcon.port"] = String(await findFreeMcPort(25575, used));
      values["enable-rcon"] = "true";
      values["rcon.password"] = randomBytes(12).toString("hex");
    }
    persist(instance, values);
    if (reserve) reservations.set(instance.instanceUuid, { ...values });
    return selected;
  });
}
export function assignFreeMcPort(
  instance: Instance,
  requested?: number,
  preserved?: NetworkSnapshot,
  reserve = false
): Promise<number> {
  return assign(instance, false, requested, preserved, reserve);
}
export function assignFreeBedrockPort(
  instance: Instance,
  requested?: number,
  preserved?: NetworkSnapshot,
  reserve = false
): Promise<number> {
  return assign(instance, true, requested, preserved, reserve);
}
