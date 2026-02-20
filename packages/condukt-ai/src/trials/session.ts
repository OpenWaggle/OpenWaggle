import { randomUUID } from "node:crypto";

import { diagnoseFailure } from "../diagnostics.js";
import type { PipelineTrace } from "../pipeline.js";
import { normalizeRequiredString, normalizeString, normalizeStringArray } from "./shared.js";
import type {
  CompleteTrialSessionInput,
  CreateTrialSessionInput,
  TrialExpectation,
  TrialRecord,
  TrialSession,
} from "./types.js";

/**
 * Starts a diagnosis trial session with normalized expectation metadata.
 *
 * @remarks
 * If `trace` is provided, expectation fields are derived from its first failure
 * unless explicitly overridden in `expected`.
 */
export function createTrialSession(input: CreateTrialSessionInput): TrialSession {
  const expectedFromTrace = input.trace ? expectationFromTrace(input.trace) : undefined;
  const expected: TrialExpectation = {
    task: normalizeString(input.expected?.task ?? expectedFromTrace?.task),
    error_code: normalizeString(input.expected?.error_code ?? expectedFromTrace?.error_code),
    contract_paths: normalizeStringArray(
      input.expected?.contract_paths ?? expectedFromTrace?.contract_paths ?? [],
    ),
  };

  if (!expected.task && !expected.error_code) {
    throw new Error("trial expectation must include task or error_code");
  }

  return {
    session_id: input.sessionId ?? randomUUID(),
    participant: normalizeRequiredString(input.participant, "participant"),
    scenario: normalizeRequiredString(input.scenario, "scenario"),
    mode: input.mode,
    started_at: input.startedAt ?? nowIso(),
    expected,
    pipeline: input.trace?.pipeline,
  };
}

/**
 * Completes a trial session and computes elapsed time and correctness flags.
 */
export function completeTrialSession(input: CompleteTrialSessionInput): TrialRecord {
  const finishedAt = input.finishedAt ?? nowIso();
  const elapsedMs = Math.max(
    0,
    new Date(finishedAt).getTime() - new Date(input.session.started_at).getTime(),
  );

  const diagnosedTask = normalizeString(input.diagnosed.task);
  const diagnosedErrorCode = normalizeString(input.diagnosed.error_code);
  const matchedTask = matchField(input.session.expected.task, diagnosedTask);
  const matchedErrorCode = matchField(input.session.expected.error_code, diagnosedErrorCode);
  const diagnosisCorrect = [matchedTask, matchedErrorCode].every((value) => value !== false);

  return {
    session_id: input.session.session_id,
    participant: input.session.participant,
    scenario: input.session.scenario,
    mode: input.session.mode,
    started_at: input.session.started_at,
    finished_at: finishedAt,
    elapsed_ms: elapsedMs,
    expected: input.session.expected,
    diagnosed: {
      task: diagnosedTask,
      error_code: diagnosedErrorCode,
    },
    matched_task: matchedTask,
    matched_error_code: matchedErrorCode,
    diagnosis_correct: diagnosisCorrect,
    notes: normalizeString(input.notes),
  };
}

function expectationFromTrace(trace: PipelineTrace): TrialExpectation {
  const diagnosis = diagnoseFailure(trace);
  if (!diagnosis.failed) {
    throw new Error("trace has no failure; cannot derive diagnosis expectation");
  }

  return {
    task: diagnosis.task,
    error_code: diagnosis.error_code,
    contract_paths: diagnosis.contract_paths,
  };
}

function matchField(expected: string | undefined, actual: string | undefined): boolean | null {
  if (!expected) {
    return null;
  }

  return expected === actual;
}

function nowIso(): string {
  return new Date().toISOString();
}
