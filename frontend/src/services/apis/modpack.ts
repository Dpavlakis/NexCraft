import { useDefineApi } from "@/stores/useDefineApi";

export interface ModpackHit {
  id: string;
  slug?: string;
  title: string;
  description: string;
  icon_url?: string;
  author?: string;
  downloads?: number;
  source: string; // "CurseForge" | "Modrinth"
}

export interface ModpackVersion {
  // CurseForge shape
  fileId?: string;
  displayName?: string;
  fileName?: string;
  mcVersion?: string;
  loader?: string;
  hasServerPack?: boolean;
  releaseType?: number;
  // Modrinth shape
  id?: string;
  name?: string;
  version_number?: string;
  game_versions?: string[];
  loaders?: string[];
}

// Search modpacks (reuses the existing mod-search endpoint with type=modpack)
export const modpackSearch = useDefineApi<
  {
    params: {
      query: string;
      source: string; // curseforge | modrinth
      type: string; // "modpack"
      sort?: string; // featured | popularity | lastupdated | name | author | totaldownloads
      offset?: number;
      limit?: number;
    };
  },
  { hits: ModpackHit[]; total_hits: number }
>({
  url: "/api/mod/search",
  method: "GET"
});

export interface ModpackDetail {
  name?: string;
  summary?: string;
  author?: string;
  iconUrl?: string;
  downloads?: number;
  screenshots?: string[];
  categories?: string[];
  gameVersions?: string[];
  updated?: string;
  websiteUrl?: string;
  description?: string;
}

// Full project detail for the install/detail dialog
export const modpackDetail = useDefineApi<
  {
    params: { source: string; projectId: string };
  },
  ModpackDetail
>({
  url: "/api/protected_modpack/detail",
  method: "GET"
});

// List installable versions of a modpack
export const modpackVersions = useDefineApi<
  {
    params: {
      source: string;
      projectId: string;
    };
  },
  ModpackVersion[]
>({
  url: "/api/protected_modpack/versions",
  method: "GET"
});

// Install a modpack as a new instance
export const installModpack = useDefineApi<
  {
    params: { daemonId: string };
    data: {
      source: string;
      projectId: string;
      projectName: string;
      fileId: string;
      versionName?: string;
      iconUrl?: string;
      instanceName: string;
      maxMemoryMB?: number;
      acceptEula?: boolean;
    };
  },
  { taskId: string; instanceUuid: string }
>({
  url: "/api/protected_modpack/install",
  method: "POST"
});

// Update an existing modpack instance to a new version
export const updateModpack = useDefineApi<
  {
    params: { daemonId: string; uuid: string };
    data: {
      source: string;
      projectId: string;
      projectName: string;
      fileId: string;
      versionName?: string;
    };
  },
  { taskId: string }
>({
  url: "/api/protected_modpack/update",
  method: "POST"
});

export interface McVersion {
  id: string;
  type: string; // release | snapshot | old_beta | old_alpha
  releaseTime?: string;
}

// Accurate Minecraft version list (Mojang manifest)
export const mcVersionsGet = useDefineApi<Record<string, never>, McVersion[]>({
  url: "/api/protected_modpack/minecraft_versions",
  method: "GET"
});

// Server-software (Paper/Purpur/Folia) version list from their official APIs
export const serverVersionsGet = useDefineApi<
  { params: { software: string } },
  McVersion[]
>({
  url: "/api/protected_modpack/server_versions",
  method: "GET"
});

// Build a fresh server (vanilla or a loader) for any Minecraft version
export const installServer = useDefineApi<
  {
    params: { daemonId: string };
    data: {
      mcVersion: string;
      loader: string; // vanilla | fabric | forge | neoforge | quilt
      instanceName: string;
      maxMemoryMB?: number;
      acceptEula?: boolean;
    };
  },
  { taskId: string; instanceUuid: string }
>({
  url: "/api/protected_modpack/install_server",
  method: "POST"
});

// Poll a modpack install/update task
export const modpackTaskStatus = useDefineApi<
  {
    params: { daemonId: string; task_id: string };
  },
  {
    taskId: string;
    status: number; // 1 running, 0 stopped, -1 error
    instanceUuid?: string;
    phase?: string;
    downloadProgress?: { percentage: number };
  } | null
>({
  url: "/api/protected_modpack/task_status",
  method: "GET"
});
