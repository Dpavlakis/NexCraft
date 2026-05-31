import { useDefineApi } from "@/stores/useDefineApi";
import type { RemoteMappingEntry } from "@/tools/protocol";

export interface WorldInfo {
  levelName: string;
  kind: "java" | "bedrock";
  exists: boolean;
  size: number;
  lastModified: number;
}

export const worldInfo = useDefineApi<
  { params: { uuid: string; daemonId: string } },
  WorldInfo
>({
  url: "/api/protected_world/info",
  method: "GET"
});

// Returns the daemon address + one-time token to fetch the world via /download/:key/:fileName.
export const worldDownloadAddress = useDefineApi<
  { params: { uuid: string; daemonId: string } },
  {
    password: string;
    addr: string;
    remoteMappings: RemoteMappingEntry[];
    fileName: string;
  }
>({
  url: "/api/protected_world/download",
  method: "POST"
});

export const worldReplace = useDefineApi<
  { params: { uuid: string; daemonId: string }; data: { fileName: string } },
  { taskId: string }
>({
  url: "/api/protected_world/replace",
  method: "POST"
});

export const worldReset = useDefineApi<
  { params: { uuid: string; daemonId: string } },
  { taskId: string }
>({
  url: "/api/protected_world/reset",
  method: "POST"
});

export const worldTaskStatus = useDefineApi<
  { params: { uuid: string; daemonId: string; task_id: string } },
  {
    taskId: string;
    status: number; // 1 running, 0 done/stopped, -1 error
    instanceStatus?: number;
    phase?: string;
  } | null
>({
  url: "/api/protected_world/task_status",
  method: "GET"
});
