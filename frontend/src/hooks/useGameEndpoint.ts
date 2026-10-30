import { computed, toValue, type MaybeRefOrGetter } from "vue";
import type { InstanceDetail, NodeStatus } from "@/types";

type GameNode = Pick<NodeStatus, "gameHost" | "ip">;
type GameInstance = Pick<InstanceDetail, "gameEndpoint">;

// Deliberately browser-safe: validation never resolves DNS or contacts a server.
export function normalizeGameHost(value: unknown): string | null {
  if (value === undefined || value === "") return "";
  if (
    typeof value !== "string" ||
    value.length > 253 ||
    /[\s\x00-\x20\x7f-\x9f/@\\?#%]/.test(value)
  )
    return null;
  let host = value;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.includes(":")) {
    try {
      return new URL("http://[" + host + "]/").hostname.slice(1, -1);
    } catch {
      return null;
    }
  }
  if (value.includes("[") || value.includes("]")) return null;
  if (/^[\d.]+$/.test(host)) {
    const parts = host.split(".");
    return parts.length === 4 &&
      parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
      ? host
      : null;
  }
  return host
    .replace(/\.$/, "")
    .split(".")
    .every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))
    ? host.toLowerCase()
    : null;
}

function nodeHost(value: unknown): string | null {
  const direct = normalizeGameHost(value);
  if (direct !== null) return direct;
  if (
    typeof value !== "string" ||
    !/^(?:https?|wss?):\/\//i.test(value) ||
    /[\s\x00-\x20\x7f-\x9f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return normalizeGameHost(url.hostname);
  } catch {
    return null;
  }
}

export function gameAddress(instance?: GameInstance, node?: GameNode) {
  const endpoint = instance?.gameEndpoint;
  const enriched = endpoint?.host !== undefined || endpoint?.hostSource !== undefined;
  const explicit = enriched
    ? endpoint?.hostSource === "gameHost"
    : node?.gameHost !== undefined && node.gameHost !== "";
  const host = enriched
    ? normalizeGameHost(endpoint?.host)
    : explicit
    ? normalizeGameHost(node?.gameHost)
    : nodeHost(node?.ip);
  const hostSource = enriched
    ? endpoint?.hostSource || "unavailable"
    : explicit
    ? "gameHost"
    : "node";
  const port =
    host?.includes(":") && endpoint?.protocol === "udp" && endpoint.source === "server.properties"
      ? endpoint.ipv6Port
      : endpoint?.port;
  const validPort =
    endpoint?.source === "server.properties" &&
    typeof port === "number" &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535;
  const address =
    host && validPort ? (host.includes(":") ? "[" + host + "]:" + port : host + ":" + port) : "";
  return {
    address,
    source: endpoint?.source,
    port: validPort ? port : null,
    protocol: endpoint?.protocol,
    hostSource,
    hostHint: explicit
      ? "TXT_CODE_game_endpoint_player_host"
      : "TXT_CODE_game_endpoint_node_host_hint",
    sourceHint:
      endpoint?.source === "server.properties"
        ? "TXT_CODE_game_endpoint_properties_hint"
        : "TXT_CODE_game_endpoint_port_unavailable",
    unknown: !host
      ? "TXT_CODE_game_endpoint_host_unavailable"
      : "TXT_CODE_game_endpoint_port_unavailable"
  };
}

export function useGameEndpoint(
  instance: MaybeRefOrGetter<GameInstance | undefined>,
  node: MaybeRefOrGetter<GameNode | undefined> = undefined
) {
  return computed(() => gameAddress(toValue(instance), toValue(node)));
}
