import fs from "fs-extra";
import os from "os";
import path from "path";
import pidusage from "pidusage";
import Instance from "../entity/instance/instance";
import InstanceSubsystem from "./system_instance";

export interface MetricSample {
  t: number; // epoch ms
  cpu: number; // percent of the whole machine (0-100)
  memMB: number; // memory usage in MB (RSS of the whole process tree)
  players: number; // online players (from ping)
}

const SAMPLE_INTERVAL_MS = 60 * 1000;
export const LIVE_MEMORY_MAX_AGE_MS = SAMPLE_INTERVAL_MS * 2;
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

// Linux start ticks fence OS PID reuse while the asynchronous sample is pending.
// On platforms without /proc, process identity and instance run counters still fence it.
function processStartTime(pid: number): string | undefined {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf-8");
    return stat
      .slice(stat.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/)[19];
  } catch {
    return undefined;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Measure summed CPU% (per-core, can exceed 100) and RSS bytes for a pid tree.
// We sample twice ~1s apart so pidusage reports instantaneous CPU rather than
// the long-run average since process start.
async function measureTree(root: number): Promise<{ cpu: number; memBytes: number }> {
  const startTime = processStartTime(root);
  const prime = collectPidTree(root);
  await Promise.all(prime.map((p) => pidusage(p).catch(() => null)));
  await wait(1000);
  const pids = collectPidTree(root);
  const stats = await Promise.all(pids.map((p) => pidusage(p).catch(() => null)));
  if (processStartTime(root) !== startTime) throw new Error("Process changed during sample");
  let cpu = 0;
  let memBytes = 0;
  let measured = 0;
  for (const stat of stats) {
    if (!stat || !Number.isFinite(stat.memory) || stat.memory < 0) continue;
    cpu += Number.isFinite(stat.cpu) && stat.cpu >= 0 ? stat.cpu : 0;
    memBytes += stat.memory;
    measured++;
  }
  // A vanished/unreadable tree is unknown, not a real zero-byte measurement.
  if (!measured || !Number.isFinite(memBytes)) throw new Error("No process memory measurement");
  return { cpu, memBytes };
}

interface ProcessRun {
  process: NonNullable<Instance["process"]>;
  pid: number | string;
  startCount: number;
  startTimestamp: number;
  processType: string;
}

class MetricsService {
  private series = new Map<string, MetricSample[]>();
  private dirty = new Set<string>();
  private loaded = false;
  // Live evidence is deliberately separate from persisted, rounded chart history.
  private liveMemory = new WeakMap<Instance, ProcessRun & { bytes: number; measuredAt: number }>();
  private sampling = new WeakMap<Instance, ProcessRun>();

  private run(instance: Instance): ProcessRun | undefined {
    const status = instance.status();
    const process = instance.process;
    if (
      !process?.pid ||
      (status !== Instance.STATUS_STARTING && status !== Instance.STATUS_RUNNING)
    )
      return;
    return {
      process,
      pid: process.pid,
      startCount: instance.startCount,
      startTimestamp: instance.startTimestamp,
      processType: instance.config.processType
    };
  }

  private sameRun(instance: Instance, run: ProcessRun) {
    const current = this.run(instance);
    return (
      !!current &&
      current.process === run.process &&
      current.pid === run.pid &&
      current.startCount === run.startCount &&
      current.startTimestamp === run.startTimestamp &&
      current.processType === run.processType
    );
  }

  public getLiveInfo(instance: Instance) {
    const info = { ...instance.info };
    const run = this.run(instance);
    const sample = this.liveMemory.get(instance);
    const age = sample ? Date.now() - sample.measuredAt : Infinity;
    const fresh =
      !!run &&
      !!sample &&
      this.sameRun(instance, sample) &&
      age >= 0 &&
      age <= LIVE_MEMORY_MAX_AGE_MS;
    if (!fresh) this.liveMemory.delete(instance);
    // DockerStatsTask remains the authority for container RSS/limits. General
    // processes may use only this run's actual sampler result, never chart data.
    info.memoryUsage =
      run?.processType === "docker"
        ? typeof info.memoryUsage === "number" &&
          Number.isFinite(info.memoryUsage) &&
          info.memoryUsage >= 0
          ? info.memoryUsage
          : undefined
        : fresh
        ? sample!.bytes
        : undefined;
    if (!run || run.processType !== "docker") {
      info.memoryLimit = undefined;
      info.memoryUsagePercent = undefined;
    }
    return info;
  }

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

  private async sampleInstance(instance: Instance, now: number) {
    const run = this.run(instance);
    const previous = this.sampling.get(instance);
    if (previous && this.sameRun(instance, previous)) return;
    if (run) this.sampling.set(instance, run);
    const current = () =>
      InstanceSubsystem.instances.get(instance.instanceUuid) === instance &&
      !!run &&
      this.sampling.get(instance) === run &&
      this.sameRun(instance, run);
    try {
      const info = instance.info;
      let cpu = 0;
      let memMB = 0;
      if (run) {
        if (run.processType === "docker") {
          // Container IDs are not host PIDs. Keep the native Docker stats source.
          const memory = this.getLiveInfo(instance).memoryUsage;
          cpu = Number(info.cpuUsage) || 0;
          memMB = memory == null ? 0 : Math.round(memory / 1024 / 1024);
        } else {
          try {
            const pid = Number(run.pid);
            if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid process PID");
            const { cpu: treeCpu, memBytes } = await measureTree(pid);
            if (!current()) return;
            cpu = Math.round((treeCpu / CPU_CORES) * 10) / 10;
            memMB = Math.round(memBytes / 1024 / 1024);
            this.liveMemory.set(instance, { ...run, bytes: memBytes, measuredAt: Date.now() });
          } catch {
            if (!current()) return;
            this.liveMemory.delete(instance);
          }
        }
        if (!current()) return;
      } else {
        this.liveMemory.delete(instance);
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
    } finally {
      if (run && this.sampling.get(instance) === run) this.sampling.delete(instance);
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
