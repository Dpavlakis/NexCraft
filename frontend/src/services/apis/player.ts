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
