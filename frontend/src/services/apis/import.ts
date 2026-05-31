import { useDefineApi } from "@/stores/useDefineApi";

// Result of scanning an existing instance's files to figure out what server it is.
export interface IServerDetectResult {
  kind: string; // vanilla | paper | purpur | folia | fabric | forge | neoforge | quilt | modpack | bedrock | unknown
  loader?: string;
  mcVersion?: string;
  startCommand?: string;
  worldName: string;
  manifest?: Record<string, any>;
  packName?: string;
}

// A best-effort match of detected files against a CurseForge/Modrinth project.
export interface IPackGuess {
  source: string; // CurseForge | Modrinth
  projectId: string;
  projectName: string;
  confidence: number;
  versions: any[];
}

// Scan an instance's directory and detect server kind / loader / version / world.
export const importDetect = useDefineApi<
  { params: { daemonId: string }; data: { instanceUuid: string } },
  IServerDetectResult
>({
  url: "/api/protected_import/detect",
  method: "POST"
});

// Try to match a detection result against a known modpack project.
export const importIdentify = useDefineApi<
  { data: Partial<IServerDetectResult> },
  IPackGuess | null
>({
  url: "/api/protected_import/identify",
  method: "POST"
});

// Finalize the import: persist start command / packInfo onto the instance config.
export const importFinalize = useDefineApi<
  {
    params: { daemonId: string };
    data: {
      instanceUuid: string;
      kind: string;
      startCommand?: string;
      packInfo?: Record<string, any>;
    };
  },
  { instanceUuid: string }
>({
  url: "/api/protected_import/finalize",
  method: "POST"
});
