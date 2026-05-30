import axios from "axios";
import { createWriteStream } from "fs";
import fs from "fs-extra";
import path from "path";
import { Throttle } from "stream-throttle";
import { getCommonHeaders } from "../common/network";
import { globalConfiguration } from "../entity/config";

export const DOWNLOAD_STATUS = {
  DOWNLOADING: 0,
  COMPLETED: 1,
  ERROR: 2
};

interface DownloadTask {
  id: string;
  path: string;
  total: number;
  current: number;
  status: number;
  error?: string;
  controller: AbortController;
}

class DownloadManager {
  public tasks: DownloadTask[] = [];

  // Large single files (server packs, JREs) download much faster over several
  // parallel range requests — CDNs (e.g. Cloudflare) commonly cap throughput per
  // connection, so one stream tops out well below the link speed.
  private readonly SEGMENT_MIN_BYTES = 16 * 1024 * 1024;
  private readonly SEGMENT_COUNT = 8;

  public get downloadingCount() {
    return this.tasks.length;
  }

  private removeTaskSoon(taskId: string) {
    setTimeout(() => {
      this.tasks = this.tasks.filter((t) => t.id !== taskId);
    }, 1000);
  }

  public async downloadFromUrl(
    url: string,
    targetPath: string,
    fallbackUrl?: string
  ): Promise<void> {
    const taskId = Math.random().toString(36).substring(2, 15);
    const controller = new AbortController();
    const task: DownloadTask = {
      id: taskId,
      path: targetPath,
      total: 0,
      current: 0,
      status: DOWNLOAD_STATUS.DOWNLOADING,
      controller
    };
    this.tasks.push(task);

    try {
      // Ensure directory exists
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) fs.mkdirpSync(dir);

      const speedLimit = Number(globalConfiguration.config.downloadSpeedRate) || 0;

      // Prefer a parallel segmented download for large files when not throttled
      // and the server supports byte ranges; otherwise use a single stream.
      if (speedLimit <= 0) {
        const total = await this.probeRangeTotal(url, controller);
        if (total >= this.SEGMENT_MIN_BYTES) {
          task.total = total;
          try {
            await this.runSegmented(url, targetPath, task, total, controller);
            if (controller.signal.aborted) {
              this.removeTaskSoon(taskId);
              return;
            }
            task.current = total;
            task.status = DOWNLOAD_STATUS.COMPLETED;
            this.removeTaskSoon(taskId);
            return;
          } catch (segErr: any) {
            if (controller.signal.aborted || segErr?.name === "CanceledError") {
              this.removeTaskSoon(taskId);
              return;
            }
            // Segmented failed mid-way (a range request hiccup) — discard the
            // partial file and retry the whole thing as a plain single stream.
            try {
              await fs.remove(targetPath);
            } catch {
              // ignore
            }
            task.current = 0;
          }
        }
      }

      await this.runSingleStream(url, targetPath, task, controller, speedLimit);
      if (controller.signal.aborted) {
        this.removeTaskSoon(taskId);
        return;
      }
      task.status = DOWNLOAD_STATUS.COMPLETED;
      if (task.total > 0) task.current = task.total;
      this.removeTaskSoon(taskId);
      return;
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === "CanceledError") {
        this.tasks = this.tasks.filter((t) => t.id !== taskId);
        return;
      }
      if (fallbackUrl) {
        this.tasks = this.tasks.filter((t) => t.id !== taskId);
        return await this.downloadFromUrl(fallbackUrl, targetPath);
      }
      task.status = DOWNLOAD_STATUS.ERROR;
      task.error = err?.message;
      this.removeTaskSoon(taskId);
      throw err;
    }
  }

  // Probe whether the server supports byte ranges; return the total size (0 if
  // ranges aren't supported, the size is unknown, or the probe failed).
  private async probeRangeTotal(url: string, controller: AbortController): Promise<number> {
    try {
      const resp = await axios({
        method: "get",
        url,
        responseType: "stream",
        timeout: 60000,
        headers: { ...getCommonHeaders(url), Range: "bytes=0-0" },
        maxRedirects: 10,
        signal: controller.signal,
        validateStatus: (s) => s === 206 || s === 200
      });
      try {
        resp.data?.destroy?.();
      } catch {
        // ignore — we only needed the headers
      }
      if (resp.status !== 206) return 0; // server ignored Range → no segmenting
      const contentRange = String(resp.headers["content-range"] || "");
      const m = /\/(\d+)\s*$/.exec(contentRange);
      return m ? parseInt(m[1], 10) || 0 : 0;
    } catch {
      return 0;
    }
  }

  // Download `total` bytes as SEGMENT_COUNT parallel range requests, each writing
  // to its own offset in the pre-sized target file.
  private async runSegmented(
    url: string,
    targetPath: string,
    task: DownloadTask,
    total: number,
    controller: AbortController
  ): Promise<void> {
    const count = this.SEGMENT_COUNT;
    const partSize = Math.ceil(total / count);
    // Pre-size the file so each segment can write at its own offset (flags "r+").
    await fs.ensureFile(targetPath);
    await fs.truncate(targetPath, total);

    const progress = new Array<number>(count).fill(0);
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      const start = i * partSize;
      if (start >= total) break;
      const end = Math.min(start + partSize - 1, total - 1);
      const index = i;
      jobs.push(
        this.downloadSegment(url, targetPath, start, end, controller, (got) => {
          progress[index] = got;
          task.current = progress.reduce((a, b) => a + b, 0);
        })
      );
    }
    await Promise.all(jobs);
  }

  private downloadSegment(
    url: string,
    targetPath: string,
    start: number,
    end: number,
    controller: AbortController,
    onProgress: (got: number) => void
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      axios({
        method: "get",
        url,
        responseType: "stream",
        timeout: 60000,
        headers: { ...getCommonHeaders(url), Range: `bytes=${start}-${end}` },
        maxRedirects: 10,
        signal: controller.signal,
        validateStatus: (s) => s === 206
      })
        .then((resp) => {
          const stream = resp.data;
          const ws = createWriteStream(targetPath, { flags: "r+", start });
          let got = 0;
          const fail = (err: any) => {
            try {
              stream.destroy();
            } catch {
              // ignore
            }
            try {
              ws.destroy();
            } catch {
              // ignore
            }
            if (err?.name === "CanceledError" || controller.signal.aborted) return resolve();
            reject(err);
          };
          stream.on("data", (chunk: Buffer) => {
            got += chunk.length;
            onProgress(got);
          });
          stream.on("error", fail);
          ws.on("error", fail);
          ws.on("finish", () => resolve());
          stream.pipe(ws);
        })
        .catch((err) => {
          if (err?.name === "CanceledError" || controller.signal.aborted) return resolve();
          reject(err);
        });
    });
  }

  // Classic single-connection download (used as a fallback, for small files, or
  // when a download speed limit is configured).
  private runSingleStream(
    url: string,
    targetPath: string,
    task: DownloadTask,
    controller: AbortController,
    speedLimit: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.requestWithRetry(url, controller)
        .then((response) => {
          const total = parseInt(response.headers["content-length"] || "0");
          if (total > 0) task.total = total;
          let current = 0;
          const stream = response.data;
          const writeStream = createWriteStream(targetPath);

          const onError = (err: Error) => {
            stream.destroy();
            writeStream.destroy();
            if (err.name === "CanceledError") return resolve();
            reject(err);
          };

          stream.on("data", (chunk: any) => {
            current += chunk.length;
            task.current = current;
          });
          stream.on("error", onError);
          writeStream.on("error", onError);
          writeStream.on("finish", () => resolve());

          if (speedLimit <= 0) {
            stream.pipe(writeStream);
            return;
          }
          const throttleStream = new Throttle({ rate: speedLimit * 64 * 1024 });
          throttleStream.on("error", onError);
          stream.pipe(throttleStream).pipe(writeStream);
        })
        .catch((err) => reject(err));
    });
  }

  public stop(targetPath: string) {
    const task = this.tasks.find((t) => t.path === targetPath);
    if (!task) return false;

    task.controller.abort();
    this.tasks = this.tasks.filter((t) => t.id !== task.id);
    setTimeout(() => {
      fs.remove(task.path).catch(() => {});
    }, 1000);
    return true;
  }

  public stopById(taskId: string) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return false;

    task.controller.abort();
    this.tasks = this.tasks.filter((t) => t.id !== task.id);
    setTimeout(() => {
      fs.remove(task.path).catch(() => {});
    }, 1000);
    return true;
  }

  private async requestWithRetry(
    url: string,
    controller: AbortController,
    retries = 2
  ): Promise<any> {
    try {
      return await axios({
        method: "get",
        url: url,
        responseType: "stream",
        timeout: 60000,
        headers: getCommonHeaders(url),
        maxRedirects: 10,
        signal: controller.signal
      });
    } catch (err: any) {
      if (controller.signal.aborted) throw err;

      const isNetworkError =
        !err.response &&
        (err.code === "ECONNRESET" || err.code === "ETIMEDOUT" || err.code === "ECONNABORTED");
      const isRetryableStatus = [500, 502, 503, 504].includes(err.response?.status);

      if (retries > 0 && (isNetworkError || isRetryableStatus)) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return await this.requestWithRetry(url, controller, retries - 1);
      }
      if (err.response?.status === 403) {
        throw new Error(
          `Access denied (403) for ${url}. This might be a premium plugin or Cloudflare protection.`
        );
      }
      throw err;
    }
  }
}

const downloadManager = new DownloadManager();

export default downloadManager;
