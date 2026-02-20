import { validateContract } from "../contracts.js";
import { buildDependencyLevels } from "./graph.js";
import type { PipelineRuntimeEnvironment } from "./runtime.js";
import {
  asErrorMessage,
  buildTaskErrorTrace,
  buildTaskSkippedTrace,
  summarizeTaskTrace,
} from "./trace.js";
import {
  ERROR_CODE_CONTRACT_OUTPUT_VIOLATION,
  ERROR_CODE_TASK_DEPENDENCY_MISSING,
  ERROR_CODE_TASK_EXECUTION_FAILURE,
  TRACE_VERSION,
  type PipelineRunResult,
  type PipelineTrace,
  type TaskAttemptTrace,
  type TaskDefinition,
  type TaskOutputMap,
  type TaskRetryPolicy,
  type TaskRuntimeContext,
  type TaskTrace,
} from "./types.js";

interface NormalizedTaskRetryPolicy {
  readonly retries: number;
  readonly backoffMs: number;
  readonly jitterMs: number;
  readonly retryIf: "error" | "execution_error" | "contract_violation";
}

interface LevelTaskResult {
  readonly task: TaskDefinition;
  readonly trace: TaskTrace;
}

export async function runPipeline<TOutputs extends TaskOutputMap>(args: {
  readonly pipelineName: string;
  readonly tasksById: ReadonlyMap<string, TaskDefinition>;
  readonly runtime: PipelineRuntimeEnvironment;
}): Promise<PipelineRunResult<TOutputs>> {
  const levels = buildDependencyLevels(Array.from(args.tasksById.values()));
  const taskOrder = levels.flat();

  const startedAt = args.runtime.nowIso();
  const outputs: Record<string, unknown> = {};
  const taskResults: Record<string, TaskTrace> = {};
  const taskTrace: TaskTrace[] = [];
  let failed = false;

  for (const level of levels) {
    const levelResults = await Promise.all(
      level.map(async (taskId): Promise<LevelTaskResult> => {
        const task = args.tasksById.get(taskId);
        if (!task) {
          throw new Error(`internal error: task '${taskId}' missing from registry`);
        }

        const dependencyOutputs: Record<string, unknown> = {};
        for (const dependency of task.after ?? []) {
          if (!(dependency in outputs)) {
            return {
              task,
              trace: buildTaskErrorTrace({
                task,
                startedAt: args.runtime.nowIso(),
                finishedAt: args.runtime.nowIso(),
                durationMs: 0,
                errorCode: ERROR_CODE_TASK_DEPENDENCY_MISSING,
                error: `dependency output missing: ${dependency}`,
              }),
            };
          }
          dependencyOutputs[dependency] = outputs[dependency];
        }

        const context = {
          outputs,
          taskResults,
          dependencyOutputs,
        };

        if (task.when) {
          const conditionStartedAt = args.runtime.nowIso();
          const conditionStartedMs = args.runtime.nowMs();
          try {
            const shouldRun = await task.when(context);
            if (!shouldRun) {
              return {
                task,
                trace: buildTaskSkippedTrace({
                  task,
                  startedAt: conditionStartedAt,
                  finishedAt: args.runtime.nowIso(),
                  durationMs: args.runtime.nowMs() - conditionStartedMs,
                  reason: "condition returned false",
                }),
              };
            }
          } catch (error) {
            return {
              task,
              trace: buildTaskErrorTrace({
                task,
                startedAt: conditionStartedAt,
                finishedAt: args.runtime.nowIso(),
                durationMs: args.runtime.nowMs() - conditionStartedMs,
                errorCode: ERROR_CODE_TASK_EXECUTION_FAILURE,
                error: `task condition failed: ${asErrorMessage(error)}`,
              }),
            };
          }
        }

        const trace = await executeTaskWithRetry(task, context, args.runtime);
        return { task, trace };
      }),
    );

    for (const result of levelResults) {
      taskTrace.push(result.trace);
      taskResults[result.task.id] = result.trace;

      if (result.trace.status === "ok") {
        outputs[result.task.id] = result.trace.output;
        continue;
      }

      if (result.trace.status === "error") {
        failed = true;
      }
    }

    if (failed) {
      break;
    }
  }

  const finishedAt = args.runtime.nowIso();
  const summary = summarizeTaskTrace(taskTrace);

  const trace: PipelineTrace = {
    trace_version: TRACE_VERSION,
    pipeline: args.pipelineName,
    status: failed ? "failed" : "ok",
    started_at: startedAt,
    finished_at: finishedAt,
    execution: {
      mode: "level_parallel",
      levels,
    },
    task_order: taskOrder,
    tasks: taskTrace,
    summary,
  };

  return {
    trace,
    outputs: outputs as Partial<TOutputs>,
    taskResults,
  };
}

async function executeTaskWithRetry(
  task: TaskDefinition,
  context: TaskRuntimeContext,
  runtime: PipelineRuntimeEnvironment,
): Promise<TaskTrace> {
  const retryPolicy = normalizeRetryPolicy(task.retry);
  const maxAttempts = retryPolicy.retries + 1;
  const attemptHistory: TaskAttemptTrace[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const taskStartedAt = runtime.nowIso();
    const startedMs = runtime.nowMs();

    try {
      const result = await task.run(context);
      const validation = await validateContract(task.output, result.data);
      const taskFinishedAt = runtime.nowIso();
      const durationMs = runtime.nowMs() - startedMs;

      if (!validation.ok) {
        const trace = buildTaskErrorTrace({
          task,
          startedAt: taskStartedAt,
          finishedAt: taskFinishedAt,
          durationMs,
          input: result.input,
          rawOutput: result.rawOutput,
          meta: result.meta,
          errorCode: ERROR_CODE_CONTRACT_OUTPUT_VIOLATION,
          error: "task output contract violation",
          contractIssues: validation.issues,
          attempts: recordAttempt(attemptHistory, {
            attempt,
            status: "error",
            error_code: ERROR_CODE_CONTRACT_OUTPUT_VIOLATION,
            error: "task output contract violation",
            started_at: taskStartedAt,
            finished_at: taskFinishedAt,
            duration_ms: durationMs,
          }),
        });

        if (!shouldRetry(retryPolicy, trace.error_code, attempt, maxAttempts)) {
          return trace;
        }
      } else {
        return {
          task: task.id,
          status: "ok",
          started_at: taskStartedAt,
          finished_at: taskFinishedAt,
          duration_ms: durationMs,
          input: result.input,
          output: validation.value,
          raw_output: result.rawOutput,
          meta: result.meta,
          attempts:
            maxAttempts > 1
              ? recordAttempt(attemptHistory, {
                  attempt,
                  status: "ok",
                  started_at: taskStartedAt,
                  finished_at: taskFinishedAt,
                  duration_ms: durationMs,
                })
              : undefined,
        };
      }
    } catch (error) {
      const taskFinishedAt = runtime.nowIso();
      const durationMs = runtime.nowMs() - startedMs;
      const trace = buildTaskErrorTrace({
        task,
        startedAt: taskStartedAt,
        finishedAt: taskFinishedAt,
        durationMs,
        errorCode: ERROR_CODE_TASK_EXECUTION_FAILURE,
        error: asErrorMessage(error),
        attempts: recordAttempt(attemptHistory, {
          attempt,
          status: "error",
          error_code: ERROR_CODE_TASK_EXECUTION_FAILURE,
          error: asErrorMessage(error),
          started_at: taskStartedAt,
          finished_at: taskFinishedAt,
          duration_ms: durationMs,
        }),
      });
      if (!shouldRetry(retryPolicy, trace.error_code, attempt, maxAttempts)) {
        return trace;
      }
    }

    const delayMs = retryDelayMs(retryPolicy, attempt, runtime);
    if (delayMs > 0) {
      await runtime.sleep(delayMs);
    }
  }

  return buildTaskErrorTrace({
    task,
    startedAt: runtime.nowIso(),
    finishedAt: runtime.nowIso(),
    durationMs: 0,
    errorCode: ERROR_CODE_TASK_EXECUTION_FAILURE,
    error: "task attempts exhausted",
    attempts: attemptHistory,
  });
}

function normalizeRetryPolicy(policy: TaskRetryPolicy | undefined): NormalizedTaskRetryPolicy {
  return {
    retries: Math.max(0, Math.floor(policy?.retries ?? 0)),
    backoffMs: Math.max(0, policy?.backoffMs ?? 0),
    jitterMs: Math.max(0, policy?.jitterMs ?? 0),
    retryIf: policy?.retryIf ?? "error",
  };
}

function shouldRetry(
  policy: NormalizedTaskRetryPolicy,
  errorCode: string | undefined,
  attempt: number,
  maxAttempts: number,
): boolean {
  if (attempt >= maxAttempts) {
    return false;
  }

  if (policy.retryIf === "error") {
    return true;
  }

  if (policy.retryIf === "contract_violation") {
    return errorCode === ERROR_CODE_CONTRACT_OUTPUT_VIOLATION;
  }

  if (policy.retryIf === "execution_error") {
    return errorCode === ERROR_CODE_TASK_EXECUTION_FAILURE;
  }

  return false;
}

function retryDelayMs(
  policy: NormalizedTaskRetryPolicy,
  attempt: number,
  runtime: PipelineRuntimeEnvironment,
): number {
  const backoff = policy.backoffMs > 0 ? policy.backoffMs * 2 ** (attempt - 1) : 0;
  const jitter = policy.jitterMs > 0 ? runtime.random() * policy.jitterMs : 0;
  return Math.max(0, backoff + jitter);
}

function recordAttempt(
  attemptHistory: TaskAttemptTrace[],
  attempt: TaskAttemptTrace,
): readonly TaskAttemptTrace[] {
  attemptHistory.push(attempt);
  return [...attemptHistory];
}
