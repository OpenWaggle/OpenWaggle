import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { ContractIssue } from "../contracts.js";

/** Version identifier for the serialized pipeline trace contract. */
export const TRACE_VERSION = "ts-0.1";

/** Error code used when a task output fails contract validation. */
export const ERROR_CODE_CONTRACT_OUTPUT_VIOLATION = "CONTRACT_OUTPUT_VIOLATION";
/** Error code used when a dependency output required by a task is unavailable. */
export const ERROR_CODE_TASK_DEPENDENCY_MISSING = "TASK_DEPENDENCY_MISSING";
/** Error code used for non-contract task execution failures. */
export const ERROR_CODE_TASK_EXECUTION_FAILURE = "TASK_EXECUTION_FAILURE";

/** Retry behavior configuration for a single task. */
export interface TaskRetryPolicy {
  readonly retries?: number;
  readonly backoffMs?: number;
  readonly jitterMs?: number;
  readonly retryIf?: "error" | "execution_error" | "contract_violation";
}

/** Pipeline output map keyed by task id. */
export type TaskOutputMap = Record<string, unknown>;
/** Task id keys available in a specific output map. */
export type TaskOutputKey<TOutputs extends TaskOutputMap> = Extract<keyof TOutputs, string>;

/** Merges a task output into an existing output map under its task id. */
export type MergeTaskOutputs<
  TOutputs extends TaskOutputMap,
  TTaskId extends string,
  TOutput,
> = Omit<TOutputs, TTaskId> & Record<TTaskId, TOutput>;

/**
 * Type-level guard that rejects duplicate task ids in fluent pipeline builders.
 */
export type DuplicateTaskIdConstraint<TOutputs extends TaskOutputMap, TTaskId extends string> =
  TTaskId extends TaskOutputKey<TOutputs>
    ? { readonly __duplicate_task_id__: never }
    : Record<never, never>;

/**
 * Runtime context exposed to each task at execution time.
 *
 * @typeParam TOutputs - Full typed output map accumulated so far.
 * @typeParam TDependencies - Task ids declared in `after`.
 */
export interface TaskRuntimeContext<
  TOutputs extends TaskOutputMap = TaskOutputMap,
  TDependencies extends readonly TaskOutputKey<TOutputs>[] = readonly TaskOutputKey<TOutputs>[],
> {
  readonly outputs: Readonly<TOutputs>;
  readonly taskResults: Readonly<Record<string, TaskTrace>>;
  readonly dependencyOutputs: Readonly<Pick<TOutputs, TDependencies[number]>>;
}

/** Conditional gate used to skip task execution when it returns `false`. */
export type TaskCondition<
  TOutputs extends TaskOutputMap = TaskOutputMap,
  TDependencies extends readonly TaskOutputKey<TOutputs>[] = readonly TaskOutputKey<TOutputs>[],
> = {
  bivarianceHack(context: TaskRuntimeContext<TOutputs, TDependencies>): boolean | Promise<boolean>;
}["bivarianceHack"];

/** Structured result returned by a task executor before contract validation. */
export interface TaskExecutionResult {
  readonly data: unknown;
  readonly input?: unknown;
  readonly rawOutput?: string;
  readonly meta?: Record<string, unknown>;
}

/**
 * Task definition consumed by the pipeline runtime.
 *
 * @typeParam TOutput - Contract-validated output type for the task.
 */
export interface TaskDefinition<
  TOutput = unknown,
  TOutputs extends TaskOutputMap = TaskOutputMap,
  TDependencies extends readonly TaskOutputKey<TOutputs>[] = readonly TaskOutputKey<TOutputs>[],
  TTaskId extends string = string,
> {
  readonly id: TTaskId;
  readonly description?: string;
  readonly after?: TDependencies;
  readonly when?: TaskCondition<TOutputs, TDependencies>;
  readonly retry?: TaskRetryPolicy;
  readonly output: StandardSchemaV1<unknown, TOutput>;
  run(context: TaskRuntimeContext<TOutputs, TDependencies>): Promise<TaskExecutionResult>;
}

/** Per-attempt execution telemetry attached to a task trace. */
export interface TaskAttemptTrace {
  readonly attempt: number;
  readonly status: "ok" | "error";
  readonly error_code?: string;
  readonly error?: string;
  readonly started_at: string;
  readonly finished_at: string;
  readonly duration_ms: number;
}

/** Full trace entry for a task execution (including retries and contract diagnostics). */
export interface TaskTrace {
  readonly task: string;
  readonly status: "ok" | "error" | "skipped";
  readonly started_at: string;
  readonly finished_at: string;
  readonly duration_ms: number;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly raw_output?: string;
  readonly meta?: Record<string, unknown>;
  readonly error?: string;
  readonly error_code?: string;
  readonly skip_reason?: string;
  readonly contract_issues?: readonly ContractIssue[];
  readonly attempts?: readonly TaskAttemptTrace[];
}

/** Top-level trace payload emitted by a pipeline run. */
export interface PipelineTrace {
  readonly trace_version: string;
  readonly pipeline: string;
  readonly status: "ok" | "failed";
  readonly started_at: string;
  readonly finished_at: string;
  readonly execution: {
    readonly mode: "level_parallel";
    readonly levels: readonly (readonly string[])[];
  };
  readonly task_order: readonly string[];
  readonly tasks: readonly TaskTrace[];
  readonly summary: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
  };
}

/**
 * Detailed result returned by {@link Pipeline.runDetailed}.
 *
 * @typeParam TOutputs - Typed map of task outputs keyed by task id.
 */
export interface PipelineRunResult<TOutputs extends TaskOutputMap> {
  readonly trace: PipelineTrace;
  readonly outputs: Readonly<Partial<TOutputs>>;
  readonly taskResults: Readonly<Record<string, TaskTrace>>;
}
