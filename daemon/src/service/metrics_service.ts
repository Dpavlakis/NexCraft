import fs from "fs-extra";
import path from "path";
import InstanceSubsystem from "./system_instance";

export interface MetricSample {
  t: number; // epoch ms
  cpu: number; // percent
  memMB: number; // memory usage in MB
  players: number; // online players (from ping)
}

const SAMPLE_INTERVAL_MS = 60 * 1000;
const MAX_POINTS = 1440; // ~24h at 60s
const METRICS_DIR = path.normalize(path.join(process.cwd(), "data", "metrics"));

class MetricsService {
  private series = new Map<string, MetricSample[]>();
  private dirty = new Set<string>();
  private loaded = false;

  private file(uuid: string) {
    return path.join(METRICS_DIR, `${uuid}.json`);
  }

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      fs.ensureDirSync(METRICS_DIR);
      for (const f of fs.readdirSync(METRICS_DIR)) {
        if (!f.endsWith(".json")) continue;
        const uuid = f.replace(/\.json$/, "");
        try {
          const arr = JSON.parse(fs.readFileSync(path.join(METRICS_DIR, f), "utf-8"));
          if (Array.isArray(arr)) this.series.set(uuid, arr.slice(-MAX_POINTS));
        } catch {
          // ignore corrupt file
        }
      }
    } catch {
      // ignore
    }
  }

  public start() {
    this.load();
    setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    // persist dirty series on a slower cadence
    setInterval(() => this.flush(), SAMPLE_INTERVAL_MS);
  }

  private sample() {
    const now = Date.now();
    for (const instance of InstanceSubsystem.instances.values()) {
      try {
        const info: any = instance.info || {};
        const running = instance.status() === 3; // STATUS_RUNNING
        const sample: MetricSample = {
          t: now,
          cpu: running ? Number(info.cpuUsage) || 0 : 0,
          memMB: running ? Math.round((Number(info.memoryUsage) || 0) / 1024 / 1024) : 0,
          players: info.mcPingOnline ? Number(info.currentPlayers) || 0 : 0
        };
        const arr = this.series.get(instance.instanceUuid) || [];
        arr.push(sample);
        if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS);
        this.series.set(instance.instanceUuid, arr);
        this.dirty.add(instance.instanceUuid);
      } catch {
        // skip this instance
      }
    }
  }

  private flush() {
    if (!this.dirty.size) return;
    try {
      fs.ensureDirSync(METRICS_DIR);
    } catch {
      return;
    }
    for (const uuid of this.dirty) {
      try {
        fs.writeFileSync(this.file(uuid), JSON.stringify(this.series.get(uuid) || []));
      } catch {
        // ignore
      }
    }
    this.dirty.clear();
  }

  public getMetrics(uuid: string, sinceMs?: number): MetricSample[] {
    this.load();
    const arr = this.series.get(uuid) || [];
    if (!sinceMs) return arr;
    return arr.filter((s) => s.t >= sinceMs);
  }
}

const metricsService = new MetricsService();
metricsService.start();
export default metricsService;
