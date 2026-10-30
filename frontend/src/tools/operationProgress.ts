// Optional additions keep older daemons compatible.
export interface OperationProgress {
  phase?: string;
  indeterminate?: boolean;
  completed?: boolean;
  percentage?: number;
  processedBytes?: number;
  totalBytes?: number;
  entries?: number;
}

export interface OperationTask {
  taskId: string;
  status: number;
  progress?: OperationProgress;
  phase?: string;
  downloadProgress?: { percentage: number };
}

const phases: Record<string, string> = {
  preparing: "preparing",
  prepare: "preparing",
  backup: "backup",
  stop: "stop",
  stopping: "stop",
  archive: "archive",
  archiving: "archive",
  compress: "archive",
  copy: "copy",
  copying: "copy",
  restore: "restore",
  restoring: "restore",
  download: "download",
  extract: "extract",
  files: "files",
  apply: "apply",
  bootstrap: "bootstrap",
  finalize: "finalize",
  finalizing: "finalize",
  finalization: "finalize",
  restart: "restart",
  cancelled: "cancelled",
  cleanup: "finalize",
  done: "done",
  completed: "done",
  failed: "failed"
};
const measured = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function presentOperationProgress(task: OperationTask | null, kind: "backup" | "update") {
  const progress = task?.progress;
  const phase = progress?.phase ?? task?.phase;
  const knownPhase =
    phase && Object.prototype.hasOwnProperty.call(phases, phase) ? phases[phase] : undefined;
  const success = task?.status === 0 && progress?.completed !== false;
  const failed = task?.status === -1;
  // A legacy archive denominator grows during discovery, so even 100% is not measurable.
  // Legacy update percentages describe the download stage alone.
  const percentage = progress
    ? progress.indeterminate === false
      ? progress.percentage
      : undefined
    : kind === "update" && phase === "download"
    ? task?.downloadProgress?.percentage
    : undefined;
  const percent = success
    ? 100
    : task?.status === 1 &&
      knownPhase &&
      knownPhase !== "done" &&
      (!measured(progress?.totalBytes) ||
        (progress.totalBytes > 0 &&
          (!measured(progress.processedBytes) ||
            progress.processedBytes <= progress.totalBytes))) &&
      measured(percentage) &&
      percentage < 100
    ? Math.floor(percentage)
    : undefined;
  return {
    phaseKey:
      "TXT_CODE_operation_phase_" +
      (success
        ? "done"
        : failed
        ? "failed"
        : knownPhase === "done"
        ? "finalize"
        : knownPhase ?? (task ? "unknown" : "preparing")),
    percent,
    entries: measured(progress?.entries) ? Math.floor(progress.entries) : undefined,
    processedBytes: measured(progress?.processedBytes) ? progress.processedBytes : undefined,
    // Only show a denominator when the daemon explicitly says it is stable.
    totalBytes:
      progress?.indeterminate === false &&
      measured(progress.totalBytes) &&
      progress.totalBytes > 0 &&
      (!measured(progress.processedBytes) || progress.totalBytes >= progress.processedBytes)
        ? progress.totalBytes
        : undefined
  };
}
