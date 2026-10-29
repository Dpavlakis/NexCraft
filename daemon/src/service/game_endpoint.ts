import fs from "fs";
import os from "os";
import { isIP } from "net";
import type Instance from "../entity/instance/instance";
import { assertSafePath } from "../utils/safe_path";

class UnsafeEndpointFile extends Error {}
function safePropertiesPath(root: string, target: string) {
  try {
    return assertSafePath(root, target);
  } catch {
    throw new UnsafeEndpointFile("Unsafe properties path");
  }
}

type EndpointInstance = Pick<Instance, "config" | "absoluteCwdPath">;
const MAX_PROPERTIES_BYTES = 128 * 1024;
const MAX_CACHE_ENTRIES = 256;
const cache = new Map<
  string,
  { signature: string; checked: number; ports: { port: number | null; ipv6Port?: number } }
>();

export function validGamePort(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (!/^\d+$/.test(String(value))) return null;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

// Read only a small regular file under the trusted instance root. Validate the
// opened descriptor as well as the path; never create/repair properties here.
function readConfiguredPorts(instance: EndpointInstance) {
  const root = instance.absoluteCwdPath();
  const file = safePropertiesPath(root, "server.properties");
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_PROPERTIES_BYTES)
    throw new UnsafeEndpointFile("Invalid properties file");
  const signature = [stat.dev, stat.ino, stat.mtimeMs, stat.ctimeMs, stat.size].join(":");
  const cached = cache.get(file);
  // A short TTL also bounds stale data on filesystems with coarse timestamps.
  if (cached?.signature === signature && Date.now() - cached.checked < 1000) return cached.ports;
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)
  );
  try {
    safePropertiesPath(root, file);
    const opened = fs.fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.dev !== stat.dev ||
      opened.ino !== stat.ino ||
      opened.size > MAX_PROPERTIES_BYTES
    )
      throw new UnsafeEndpointFile("Properties file changed");
    const bytes = Buffer.alloc(MAX_PROPERTIES_BYTES + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (count > MAX_PROPERTIES_BYTES) throw new UnsafeEndpointFile("Properties file too large");
    const values: Record<string, string> = {};
    for (const line of bytes.subarray(0, count).toString("utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(server-port|server-portv6)\s*[=:]\s*(.*?)\s*$/);
      if (match) values[match[1]] = match[2];
    }
    const ports = {
      port: validGamePort(values["server-port"]),
      ipv6Port: validGamePort(values["server-portv6"]) ?? undefined
    };
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(file, { signature, checked: Date.now(), ports });
    return ports;
  } finally {
    fs.closeSync(fd);
  }
}

export function resolveGameEndpoint(instance: EndpointInstance): IGameEndpoint {
  const type = String(instance.config?.type || "");
  const bedrock = type.includes("bedrock");
  const protocol = bedrock ? "udp" : "tcp";
  if (!type.includes("minecraft")) return { port: null, protocol, source: "unavailable" };
  try {
    const ports = readConfiguredPorts(instance);
    if (ports.port)
      return {
        port: ports.port,
        protocol,
        ...(bedrock && ports.ipv6Port ? { ipv6Port: ports.ipv6Port } : {}),
        source: "server.properties"
      };
  } catch {
    // Missing, invalid or unreadable configuration cannot establish a local endpoint.
  }
  return { port: null, protocol, source: "unavailable" };
}

// The ping target can intentionally point at another server/proxy. Only replace
// its port when the configured target is explicitly local; never resolve DNS.
export function resolveMinecraftPingPort(instance: EndpointInstance): number | null {
  const host = String(instance.config?.pingConfig?.ip || "")
    .toLowerCase()
    .replace(/^\[([^\]]+)\]$/, "$1");
  const local =
    !host ||
    ["localhost", "localhost.", "::1", "0.0.0.0", "::", os.hostname().toLowerCase()].includes(
      host
    ) ||
    (isIP(host) === 4 && host.startsWith("127.")) ||
    Object.values(os.networkInterfaces()).some(
      (interfaces) => interfaces?.some((address) => address.address.toLowerCase() === host)
    );
  return local
    ? resolveGameEndpoint(instance).port
    : validGamePort(instance.config?.pingConfig?.port);
}
