import type { ContractIssue } from "../contracts.js";
import type { TaskAttemptTrace, TaskDefinition, TaskTrace } from "./types.js";

interface BuildTaskErrorInput {
  readonly task: TaskDefinition;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly errorCode: string;
  readonly error: string;
  readonly input?: unknown;
  readonly rawOutput?: string;
  readonly meta?: Record<string, unknown>;
  readonly contractIssues?: readonly ContractIssue[];
  readonly attempts?: readonly TaskAttemptTrace[];
}

interface BuildTaskSkippedInput {
  readonly task: TaskDefinition;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly reason: string;
}

export function buildTaskErrorTrace(args: BuildTaskErrorInput): TaskTrace {
  return {
    task: args.task.id,
    status: "error",
    started_at: args.startedAt,
    finished_at: args.finishedAt,
    duration_ms: args.durationMs,
    input: args.input,
    raw_output: args.rawOutput,
    meta: args.meta,
    error_code: args.errorCode,
    error: args.error,
    contract_issues: args.contractIssues,
    attempts: args.attempts,
  };
}

export function buildTaskSkippedTrace(args: BuildTaskSkippedInput): TaskTrace {
  return {
    task: args.task.id,
    status: "skipped",
    started_at: args.startedAt,
    finished_at: args.finishedAt,
    duration_ms: args.durationMs,
    skip_reason: args.reason,
  };
}

export function summarizeTaskTrace(tasks: readonly TaskTrace[]): {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
} {
  const total = tasks.length;
  const passed = tasks.filter((task) => task.status === "ok").length;
  const failed = tasks.filter((task) => task.status === "error").length;
  const skipped = tasks.filter((task) => task.status === "skipped").length;
  return {
    total,
    passed,
    failed,
    skipped,
  };
}

export function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
