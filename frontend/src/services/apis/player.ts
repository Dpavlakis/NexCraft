import { useDefineApi } from "@/stores/useDefineApi";

export interface PlayerOverview {
  rconReady: boolean;
  running: boolean;
  online: string[];
  banned: string[];
  ops: string[];
}

export const playerList = useDefineApi<
  {
    params: { daemonId: string; uuid: string };
  },
  PlayerOverview
>({
  url: "/api/protected_player/list",
  method: "GET"
});

export const playerAction = useDefineApi<
  {
    params: { daemonId: string; uuid: string };
    data: { action: "kick" | "ban" | "pardon" | "op" | "deop"; name: string };
  },
  { result: string }
>({
  url: "/api/protected_player/action",
  method: "POST"
});

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

export type BedrockActionType =
  | "kick"
  | "allowlist_add"
  | "allowlist_remove"
  | "allowlist_on"
  | "allowlist_off"
  | "op"
  | "deop";

export const bedrockPlayerOverview = useDefineApi<
  { params: { daemonId: string; uuid: string } },
  BedrockPlayerOverview
>({
  url: "/api/protected_player/bedrock_overview",
  method: "GET"
});

export const bedrockPlayerAction = useDefineApi<
  {
    params: { daemonId: string; uuid: string };
    data: { action: BedrockActionType; name?: string };
  },
  boolean
>({
  url: "/api/protected_player/bedrock_action",
  method: "POST"
});
