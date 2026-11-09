import type { WorkerRunLineageFacts } from '../types/session-worker-runs'

/**
 * A parent's Running Workers (ADR 0063): the Workers below it, at any depth, with an active or
 * connecting Run, as the Host counted them. Zero for a Session with no Workers.
 */
export function runningWorkerCount(lineage: WorkerRunLineageFacts | null | undefined): number {
  return lineage?.runningWorkerCount ?? 0
}

/**
 * The words every surface uses for Running Workers: "1 Worker running", "3 Workers running".
 * Always "running", never "working", which names the Hive panel's Next actor group.
 */
export function runningWorkersLabel(count: number) {
  return `${String(count)} ${count === 1 ? 'Worker' : 'Workers'} running`
}
