import type { TrialMode, TrialRecord } from "./types.js";
import { normalizeRequiredString, normalizeString } from "./shared.js";

/**
 * Normalizes trial mode aliases to canonical values.
 *
 * @remarks
 * Legacy `condukt` is accepted for backwards compatibility and normalized to
 * `condukt-ai`.
 */
export function normalizeTrialMode(mode: unknown): TrialMode {
  if (mode === "baseline") {
    return "baseline";
  }

  if (mode === "condukt-ai" || mode === "condukt") {
    return "condukt-ai";
  }

  throw new Error("mode must be one of: baseline, condukt-ai, condukt");
}

/** Validates and normalizes untrusted JSON input into a {@link TrialRecord}. */
export function normalizeTrialRecord(value: unknown): TrialRecord {
  const raw = asObject(value, "record");
  const expectedRaw = asObject(raw.expected, "record.expected");
  const diagnosedRaw = asObject(raw.diagnosed, "record.diagnosed");

  const expectedTask = optionalString(expectedRaw.task, "record.expected.task");
  const expectedErrorCode = optionalString(expectedRaw.error_code, "record.expected.error_code");
  const expectedContractPaths = asStringArray(
    expectedRaw.contract_paths,
    "record.expected.contract_paths",
  );

  return {
    session_id: requiredString(raw.session_id, "record.session_id"),
    participant: requiredString(raw.participant, "record.participant"),
    scenario: requiredString(raw.scenario, "record.scenario"),
    mode: normalizeTrialMode(raw.mode),
    started_at: requiredString(raw.started_at, "record.started_at"),
    finished_at: requiredString(raw.finished_at, "record.finished_at"),
    elapsed_ms: nonNegativeNumber(raw.elapsed_ms, "record.elapsed_ms"),
    expected: {
      task: expectedTask,
      error_code: expectedErrorCode,
      contract_paths: expectedContractPaths,
    },
    diagnosed: {
      task: optionalString(diagnosedRaw.task, "record.diagnosed.task"),
      error_code: optionalString(diagnosedRaw.error_code, "record.diagnosed.error_code"),
    },
    matched_task: optionalBooleanOrNull(raw.matched_task, "record.matched_task"),
    matched_error_code: optionalBooleanOrNull(raw.matched_error_code, "record.matched_error_code"),
    diagnosis_correct: requiredBoolean(raw.diagnosis_correct, "record.diagnosis_correct"),
    notes: optionalString(raw.notes, "record.notes"),
  };
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return normalizeRequiredString(value, field);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (typeof value === "undefined" || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${field} must be a string when provided`);
  }

  return normalizeString(value);
}

function asStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }

  return value.map((entry, index) => requiredString(entry, `${field}[${index}]`));
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function optionalBooleanOrNull(value: unknown, field: string): boolean | null {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  throw new Error(`${field} must be boolean or null`);
}

function nonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }
  return value;
}
