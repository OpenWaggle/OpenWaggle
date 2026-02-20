import type { OrchestrationRunRecord, RunStore } from "./types.js";

export class MemoryRunStore implements RunStore {
  readonly #runs = new Map<string, OrchestrationRunRecord>();

  async saveRun(run: OrchestrationRunRecord): Promise<void> {
    this.#runs.set(run.runId, run);
  }

  async getRun(runId: string): Promise<OrchestrationRunRecord | null> {
    return this.#runs.get(runId) ?? null;
  }

  async listRuns(): Promise<readonly OrchestrationRunRecord[]> {
    return [...this.#runs.values()].sort((left, right) =>
      left.startedAt < right.startedAt ? 1 : -1,
    );
  }
}
