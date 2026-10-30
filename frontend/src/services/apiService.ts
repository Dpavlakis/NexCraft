import { useAppStateStore } from "@/stores/useAppStateStore";
import { reportErrorMsg } from "@/tools/validator";
import type { AxiosError, AxiosRequestConfig } from "axios";
import axios from "axios";
import EventEmitter from "eventemitter3";
import _ from "lodash";

axios.defaults.headers.common["X-Requested-With"] = "XMLHttpRequest";
axios.interceptors.request.use(async (config) => {
  const { state } = useAppStateStore();
  if (!config.params) config.params = {};
  config.params.token = state.userInfo?.token;
  return config;
});

export interface RequestConfig extends AxiosRequestConfig {
  forceRequest?: boolean;
  errorAlert?: boolean;
}
interface ResponseDataRecord {
  timestamp: number;
  data: any;
}

interface PacketProtocol<T> {
  data: T;
  status: number;
  time: number;
}

interface RequestGeneration {
  controller: AbortController;
  event: EventEmitter;
  subscribers: number;
}

class ApiService {
  private readonly pending = new Map<string, RequestGeneration>();
  private readonly responseMap = new Map<string, ResponseDataRecord>();
  private readonly RESPONSE_CACHE_TIME = 1000 * 2;
  private readonly REQUEST_CACHE_TIME = 100;

  public async subscribe<T>(config: RequestConfig): Promise<T | undefined> {
    if (!config.url) throw new Error("ApiService: RequestConfig: 'url' is empty!");

    // AbortSignal is an identity-bearing resource, not request data.
    config = { ..._.cloneDeep(config), signal: config.signal };
    const sessionToken = useAppStateStore().state.userInfo?.token;
    // filter and clean up expired cache tables
    this.responseMap.forEach((value, key) => {
      if (value.timestamp + this.RESPONSE_CACHE_TIME < Date.now()) {
        this.responseMap.delete(key);
      }
    });

    if (config.url?.startsWith("/")) {
      config.url = "." + config.url;
    }

    if (config.forceRequest === true) {
      config.params = config?.params || {};
      config.params._force = Date.now();
      return await this.sendRequest<T>(config, undefined, sessionToken);
    }

    const reqId = encodeURIComponent(
      [
        String(sessionToken),
        String(config.method),
        String(config.url),
        JSON.stringify(config.data ?? {}),
        JSON.stringify(config.params ?? {})
      ].join("")
    );

    return new Promise((resolve, reject) => {
      let generation: RequestGeneration | undefined;
      let settled = false;
      const onAbort = () => complete(new Error("Request cancelled or session changed"));
      const complete = (data: any) => {
        if (settled) return;
        settled = true;
        config.signal?.removeEventListener?.("abort", onAbort);
        if (generation) {
          generation.event.off("response", complete);
          generation.subscribers--;
          if (generation.subscribers === 0 && this.pending.get(reqId) === generation) {
            // Retire before abort: its eventual catch must not reach a new generation.
            this.pending.delete(reqId);
            generation.controller.abort();
          }
        }
        // Every subscriber, including a cache hit, owns its publication fence.
        if (config.signal?.aborted || useAppStateStore().state.userInfo?.token !== sessionToken)
          data = new Error("Request cancelled or session changed");
        if (data instanceof Error) {
          if (config.errorAlert === true) reportErrorMsg(data.message);
          reject(data);
        } else {
          resolve(_.cloneDeep(data));
        }
      };

      if (config.signal?.aborted)
        return complete(new Error("Request cancelled or session changed"));
      const cache = this.responseMap.get(reqId);
      if (cache && cache.timestamp + this.RESPONSE_CACHE_TIME > Date.now())
        return complete(cache.data);

      generation = this.pending.get(reqId);
      const startRequest = !generation;
      if (!generation) {
        generation = {
          controller: new AbortController(),
          event: new EventEmitter(),
          subscribers: 0
        };
        this.pending.set(reqId, generation);
      }
      generation.subscribers++;
      generation.event.once("response", complete);
      config.signal?.addEventListener?.("abort", onAbort, { once: true });
      if (startRequest) {
        this.sendRequest(
          { ...config, signal: generation.controller.signal },
          reqId,
          sessionToken,
          generation
        );
      }
    });
  }

  private async readWithRecovery<T>(config: RequestConfig, sessionToken?: string) {
    // Some legacy GET endpoints perform actions (including logout/open/stop).
    // Only these known reads may be retried; credentials and writes never replay.
    const safeRead =
      String(config.method ?? "GET").toUpperCase() === "GET" &&
      [
        "/api/instance",
        "/api/mod/list",
        "/api/protected_instance/outputlog",
        "/api/protected_modpack/versions",
        "/api/protected_modpack/server_versions"
      ].includes(String(config.url).replace(/^\./, ""));
    const assertCurrent = () => {
      if (config.signal?.aborted || useAppStateStore().state.userInfo?.token !== sessionToken)
        throw new Error("Request cancelled or session changed");
    };
    for (let attempt = 0; ; attempt++) {
      if (safeRead) assertCurrent();
      try {
        const response = await axios<PacketProtocol<T>>(config);
        if (safeRead) assertCurrent();
        return response;
      } catch (error) {
        const response = (error as AxiosError)?.response;
        const seconds = Number(response?.headers?.["retry-after"]);
        // Respect longer server cooldowns by surfacing them, never retrying early.
        if (
          !safeRead ||
          attempt >= 2 ||
          response?.status !== 429 ||
          !Number.isFinite(seconds) ||
          seconds <= 0 ||
          seconds > 5
        )
          throw error;
        assertCurrent();
        await this.wait(Math.max(1000, seconds * 1000), config.signal);
      }
    }
  }

  private async sendRequest<T>(
    config: RequestConfig,
    reqId?: string,
    sessionToken?: string,
    generation?: RequestGeneration
  ) {
    try {
      // Force request!
      if (!reqId) {
        const { data: result } = await this.readWithRecovery<T>(config, sessionToken);
        return result?.data;
      }

      // Request cache
      const startTime = Date.now();
      if (!config.timeout) config.timeout = 1000 * 30;
      const { data: result } = await this.readWithRecovery<T>(config, sessionToken);
      const endTime = Date.now();
      const reqSpeed = endTime - startTime;
      if (reqSpeed < this.REQUEST_CACHE_TIME)
        await this.wait(this.REQUEST_CACHE_TIME - reqSpeed, config.signal);
      // Axios may finish before this cache delay. Revalidate at publication so
      // logout/session rotation or cancellation during the delay cannot publish it.
      if (
        config.signal?.aborted ||
        useAppStateStore().state.userInfo?.token !== sessionToken ||
        this.pending.get(reqId) !== generation
      )
        throw new Error("Request cancelled or session changed");
      const realData = result.data;
      this.responseMap.set(reqId, {
        timestamp: Date.now(),
        data: realData
      });
      this.publish(reqId, generation, realData);
    } catch (error: AxiosError | Error | any) {
      const axiosErr = error as AxiosError;
      const otherErr = error as Error | any;
      if (axiosErr?.response?.data) {
        const protocol = axiosErr?.response?.data as IPanelResponseProtocol;
        if (protocol.data && protocol.status !== 200) {
          this.throwRequestError(reqId, String(protocol.data), generation);
          return;
        }
      }
      this.throwRequestError(reqId, otherErr, generation);
    }
  }

  private publish(reqId: string, generation: RequestGeneration | undefined, data: any) {
    if (!generation || this.pending.get(reqId) !== generation) return;
    this.pending.delete(reqId);
    generation.event.emit("response", data);
  }

  private throwRequestError(reqId?: string, error?: any, generation?: RequestGeneration) {
    if (!(error instanceof Error)) error = new Error(error);

    if (reqId) {
      this.publish(reqId, generation, error);
    } else {
      throw error;
    }
  }

  private wait(time: number, signal?: RequestConfig["signal"]) {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", onAbort);
        reject(new Error("Request cancelled or session changed"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener?.("abort", onAbort);
        resolve(null);
      }, time);
      signal?.addEventListener?.("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
}

export const apiService = new ApiService();
