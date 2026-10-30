import { normalizeGameHost, type IRemoteService } from "../entity/entity_interface";

type PlayerHostConfig = Pick<IRemoteService, "gameHost" | "ip">;

// Return only the player-facing host. RPC credentials, ports and other node
// settings never belong in an assigned user's instance response.
export function playerGameHost(
  config: PlayerHostConfig
): Pick<IGameEndpoint, "host" | "hostSource"> {
  const explicit = config.gameHost !== undefined && config.gameHost !== "";
  try {
    if (explicit) return { host: normalizeGameHost(config.gameHost), hostSource: "gameHost" };
    let host: string;
    try {
      host = normalizeGameHost(config.ip);
    } catch {
      if (
        typeof config.ip !== "string" ||
        !/^(?:https?|wss?):\/\//i.test(config.ip) ||
        /[\s\x00-\x20\x7f-\x9f]/.test(config.ip)
      )
        throw new Error("Invalid node host");
      const url = new URL(config.ip);
      if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
        throw new Error("Invalid node host");
      host = normalizeGameHost(url.hostname);
    }
    if (host) return { host, hostSource: "node" };
  } catch {
    // Persisted legacy node data may be invalid; keep its endpoint unavailable.
  }
  return { host: "", hostSource: "unavailable" };
}

// Call only after ownership/role checks, with the selected instance's own node.
export function withPlayerGameEndpoint<T extends { gameEndpoint?: IGameEndpoint }>(
  instance: T,
  config: PlayerHostConfig
): T {
  return {
    ...instance,
    gameEndpoint: {
      port: null,
      protocol: "tcp",
      source: "unavailable",
      ...instance.gameEndpoint,
      ...playerGameHost(config)
    }
  };
}
