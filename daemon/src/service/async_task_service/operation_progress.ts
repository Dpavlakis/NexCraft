// Percentages describe measured stage work, never estimated elapsed time.
export interface OperationProgress {
  percentage: number;
  processedBytes: number;
  totalBytes: number;
  entries: number;
  phase: string;
  indeterminate: boolean;
  completed: boolean;
}

export function indeterminateProgress(phase: string): OperationProgress {
  return {
    percentage: 0,
    processedBytes: 0,
    totalBytes: 0,
    entries: 0,
    phase,
    indeterminate: true,
    completed: false
  };
}

export function measuredProgress(
  phase: string,
  processedBytes: number,
  totalBytes: number,
  entries = 0
): OperationProgress {
  const count = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
  const processed = count(processedBytes);
  const total = count(totalBytes);
  return {
    ...indeterminateProgress(phase),
    processedBytes: processed,
    totalBytes: total,
    entries: count(entries),
    // A measurable stage finishing does not complete the containing operation.
    percentage: total > 0 ? Math.min(99, Math.round((processed / total) * 100)) : 0,
    indeterminate: total <= 0
  };
}
