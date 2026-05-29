import { useDefineApi } from "@/stores/useDefineApi";
import type { JavaRuntime } from "@/types/javaManager";

export const getJavaList = useDefineApi<
  {
    params: {
      daemonId: string;
      instanceId: string;
    };
  },
  JavaRuntime[]
>({
  url: "/api/java_manager/list",
  method: "GET"
});

export const addJava = useDefineApi<
  {
    params: {
      daemonId: string;
    };
    data: {
      name: string;
      path: string;
    };
  },
  Boolean
>({
  url: "/api/java_manager/add",
  method: "POST"
});

export const downloadJava = useDefineApi<
  {
    params: {
      daemonId: string;
      instanceId: string;
    };
    data: {
      name: string;
      version: string;
      downloadUrl?: string;
    };
  },
  Boolean
>({
  url: "/api/java_manager/download",
  method: "POST"
});

export interface JavaReleaseItem {
  vendor: string;
  version: string;
  releaseName?: string;
  releaseTime?: string;
  downloadUrl: string;
  type: string;
}

// Available major versions for a vendor (adoptium | zulu)
export const javaMajors = useDefineApi<{ params: { daemonId: string; vendor: string } }, number[]>({
  url: "/api/java_manager/list_majors",
  method: "GET"
});

// Specific releases for a vendor + major version
export const javaVersions = useDefineApi<
  { params: { daemonId: string; vendor: string; major: number } },
  JavaReleaseItem[]
>({
  url: "/api/java_manager/list_versions",
  method: "GET"
});

export const usingJava = useDefineApi<
  {
    params: {
      daemonId: string;
      instanceId: string;
    };
    data: {
      id: string;
    };
  },
  Boolean
>({
  url: "/api/java_manager/using",
  method: "POST"
});

export const deleteJava = useDefineApi<
  {
    params: {
      daemonId: string;
      instanceId: string;
    };
    data: {
      id: string;
    };
  },
  Boolean
>({
  url: "/api/java_manager/delete",
  method: "DELETE"
});
