import { useDefineApi } from "@/stores/useDefineApi";

export interface MetricSample {
  t: number;
  cpu: number;
  memMB: number;
  players: number;
}

export const metricsGet = useDefineApi<
  {
    params: { daemonId: string; uuid: string; since?: number };
  },
  MetricSample[]
>({
  url: "/api/protected_metrics/get",
  method: "GET"
});
