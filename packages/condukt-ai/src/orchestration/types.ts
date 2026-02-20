export const ORCHESTRATION_ERROR_TASK_TIMEOUT = "TASK_TIMEOUT";
export const ORCHESTRATION_ERROR_TASK_EXECUTION = "TASK_EXECUTION_FAILURE";
export const ORCHESTRATION_ERROR_TASK_CANCELLED = "TASK_CANCELLED";

export interface OrchestrationTaskRetryPolicy {
  readonly retries?: number;
  readonly backoffMs?: number;
  readonly jitterMs?: number;
}

export interface OrchestrationTaskDefinition {
  readonly id: string;
  readonly kind: string;
  readonly input?: unknown;
  readonly dependsOn?: readonly string[];
  readonly retry?: OrchestrationTaskRetryPolicy;
  readonly timeoutMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type OrchestrationTaskStatus =
  | "queued"
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export interface OrchestrationTaskAttempt {
  readonly attempt: number;
  readonly status: "ok" | "error" | "cancelled";
  readonly errorCode?: string;
  readonly error?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
}

export interface OrchestrationTaskRecord {
  readonly id: string;
  readonly kind: string;
  readonly dependsOn: readonly string[];
  readonly input?: unknown;
  readonly output?: unknown;
  readonly status: OrchestrationTaskStatus;
  readonly retry: Required<OrchestrationTaskRetryPolicy>;
  readonly timeoutMs?: number;
  readonly attempts: readonly OrchestrationTaskAttempt[];
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly errorCode?: string;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdOrder: number;
}

export type OrchestrationRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface OrchestrationRunRecord {
  readonly runId: string;
  readonly status: OrchestrationRunStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly tasks: Readonly<Record<string, OrchestrationTaskRecord>>;
  readonly taskOrder: readonly string[];
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly summary: {
    readonly total: number;
    readonly completed: number;
    readonly failed: number;
    readonly cancelled: number;
    readonly queued: number;
    readonly running: number;
    readonly retrying: number;
  };
}

export type OrchestrationEvent =
  | { readonly type: "run_started"; readonly runId: string; readonly at: string }
  | {
      readonly type: "task_queued";
      readonly runId: string;
      readonly taskId: string;
      readonly at: string;
    }
  | {
      readonly type: "task_started";
      readonly runId: string;
      readonly taskId: string;
      readonly attempt: number;
      readonly at: string;
    }
  | {
      readonly type: "task_progress";
      readonly runId: string;
      readonly taskId: string;
      readonly at: string;
      readonly payload: unknown;
    }
  | {
      readonly type: "task_retried";
      readonly runId: string;
      readonly taskId: string;
      readonly attempt: number;
      readonly nextAttempt: number;
      readonly delayMs: number;
      readonly at: string;
      readonly errorCode?: string;
      readonly error?: string;
    }
  | {
      readonly type: "task_succeeded";
      readonly runId: string;
      readonly taskId: string;
      readonly attempt: number;
      readonly at: string;
      readonly output?: unknown;
    }
  | {
      readonly type: "task_failed";
      readonly runId: string;
      readonly taskId: string;
      readonly attempt: number;
      readonly at: string;
      readonly errorCode?: string;
      readonly error?: string;
    }
  | { readonly type: "run_completed"; readonly runId: string; readonly at: string }
  | {
      readonly type: "run_failed";
      readonly runId: string;
      readonly at: string;
      readonly error?: string;
    }
  | {
      readonly type: "run_cancelled";
      readonly runId: string;
      readonly at: string;
      readonly reason?: string;
    };

export interface OrchestrationTaskContext {
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly dependencyOutputs: Readonly<Record<string, unknown>>;
  reportProgress: (payload: unknown) => void;
  spawn: (task: OrchestrationTaskDefinition) => Promise<void>;
}

export interface WorkerAdapter {
  executeTask(
    task: OrchestrationTaskDefinition,
    context: OrchestrationTaskContext,
  ): Promise<{ readonly output?: unknown }>;
}

export interface RunStore {
  saveRun(run: OrchestrationRunRecord): Promise<void>;
  getRun(runId: string): Promise<OrchestrationRunRecord | null>;
  listRuns(): Promise<readonly OrchestrationRunRecord[]>;
}

export interface OrchestrationRunDefinition {
  readonly runId?: string;
  readonly tasks: readonly OrchestrationTaskDefinition[];
  readonly maxParallelTasks?: number;
  readonly signal?: AbortSignal;
}

export interface RunSummary {
  readonly runId: string;
  readonly status: OrchestrationRunStatus;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly failedTaskIds: readonly string[];
  readonly cancelledTaskIds: readonly string[];
}

export interface OrchestrationEngine {
  run(definition: OrchestrationRunDefinition): Promise<RunSummary>;
  resume(runId: string): Promise<RunSummary>;
  cancel(runId: string, reason?: string): Promise<void>;
  getRun(runId: string): Promise<OrchestrationRunRecord | null>;
  listRuns(): Promise<readonly OrchestrationRunRecord[]>;
}
