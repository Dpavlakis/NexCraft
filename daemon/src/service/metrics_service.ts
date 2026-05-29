import fs from "fs-extra";
import os from "os";
import path from "path";
import pidusage from "pidusage";
import InstanceSubsystem from "./system_instance";

export interface MetricSample {
  t: number; // epoch ms
  cpu: number; // percent of the whole machine (0-100)
  memMB: number; // memory usage in MB (RSS of the whole process tree)
  players: number; // online players (from ping)
}

const SAMPLE_INTERVAL_MS = 60 * 1000;
const MAX_POINTS = 1440; // ~24h at 60s
const METRICS_DIR = path.normalize(path.join(process.cwd(), "data", "metrics"));
const CPU_CORES = Math.max(1, os.cpus()?.length || 1);

// Collect a process and all of its descendants (Linux /proc walk). The daemon
// container is Linux, and Minecraft servers often launch via a shell wrapper
// (e.g. `bash startserver.sh`), so the real Java memory/CPU lives in a child
// process. Measuring the whole tree is how Crafty reports accurate stats.
function collectPidTree(root: number): number[] {
  try {
    const childrenOf = new Map<number, number[]>();
    for (const entry of fs.readdirSync("/proc")) {
      const pid = Number(entry);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
        // Format: "pid (comm) state ppid ...". comm may contain spaces/parens,
        // so parse fields after the final ')'.
        const rparen = stat.lastIndexOf(")");
        if (rparen < 0) continue;
        const after = stat.slice(rparen + 2).split(" ");
        const ppid = Number(after[1]); // [0]=state, [1]=ppid
        if (!Number.isInteger(ppid)) continue;
        const list = childrenOf.get(ppid) || [];
        list.push(pid);
        childrenOf.set(ppid, list);
      } catch {
        // process vanished between readdir and read — skip
      }
    }
    const result: number[] = [];
    const seen = new Set<number>();
    const stack = [root];
    while (stack.length) {
      const p = stack.pop() as number;
      if (seen.has(p)) continue;
      seen.add(p);
      result.push(p);
      for (const c of childrenOf.get(p) || []) stack.push(c);
    }
    return result;
  } catch {
    // Non-Linux / no /proc — fall back to just the root pid
    return [root];
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Measure summed CPU% (per-core, can exceed 100) and RSS bytes for a pid tree.
// We sample twice ~1s apart so pidusage reports instantaneous CPU rather than
// the long-run average since process start.
async function measureTree(root: number): Promise<{ cpu: number; memBytes: number }> {
  const prime = collectPidTree(root);
  await Promise.all(prime.map((p) => pidusage(p).catch(() => null)));
  await wait(1000);
  const pids = collectPidTree(root);
  const stats = await Promise.all(pids.map((p) => pidusage(p).catch(() => null)));
  let cpu = 0;
  let memBytes = 0;
  for (const s of stats) {
    if (!s) continue;
    cpu += (s as any).cpu || 0;
    memBytes += (s as any).memory || 0;
  }
  return { cpu, memBytes };
}

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

  private async sample() {
    const now = Date.now();
    const jobs: Promise<void>[] = [];
    for (const instance of InstanceSubsystem.instances.values()) {
      jobs.push(this.sampleInstance(instance, now));
    }
    await Promise.all(jobs);
  }

  private async sampleInstance(instance: any, now: number) {
    try {
      const info: any = instance.info || {};
      const status = instance.status();
      // STATUS_STARTING (2) or STATUS_RUNNING (3): the process exists and is
      // worth measuring (startup is CPU-heavy and useful to chart).
      const hasProc = !!(instance.process && instance.process.pid);
      const alive = status === 2 || status === 3;

      let cpu = 0;
      let memMB = 0;
      if (hasProc && alive) {
        let measured = false;
        // Prefer a live process-tree measurement (accurate for general-mode
        // instances, including shell-wrapper start commands).
        try {
          const { cpu: treeCpu, memBytes } = await measureTree(instance.process.pid);
          // Normalize summed per-core CPU to a share of the whole machine so it
          // matches the 0-100 axis and the Overview system gauge.
          cpu = Math.round((treeCpu / CPU_CORES) * 10) / 10;
          memMB = Math.round(memBytes / 1024 / 1024);
          measured = true;
        } catch {
          // ignore — fall back below
        }
        // Docker-mode instances expose stats via instance.info instead.
        if (!measured || (cpu === 0 && memMB === 0)) {
          if (Number(info.cpuUsage) || Number(info.memoryUsage)) {
            cpu = Number(info.cpuUsage) || 0;
            memMB = Math.round((Number(info.memoryUsage) || 0) / 1024 / 1024);
          }
        }
      }

      const sample: MetricSample = {
        t: now,
        cpu,
        memMB,
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
