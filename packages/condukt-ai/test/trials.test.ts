import { expect, test } from "vitest";

import {
  completeTrialSession,
  createTrialSession,
  evaluateTrialSummary,
  normalizeTrialMode,
  normalizeTrialRecord,
  renderTrialSummaryMarkdown,
  summarizeTrialRecords,
} from "../src/trials.js";
import type { PipelineTrace } from "../src/pipeline.js";

function buildBrokenTrace(): PipelineTrace {
  return {
    trace_version: "ts-0.1",
    pipeline: "quickstart-research-write",
    status: "failed",
    started_at: "2026-02-14T10:00:00.000Z",
    finished_at: "2026-02-14T10:00:02.000Z",
    execution: {
      mode: "level_parallel",
      levels: [["research"], ["draft"]],
    },
    task_order: ["research", "draft"],
    tasks: [
      {
        task: "research",
        status: "ok",
        started_at: "2026-02-14T10:00:00.000Z",
        finished_at: "2026-02-14T10:00:01.000Z",
        duration_ms: 1000,
        output: { topics: ["a"], sources: ["b"] },
      },
      {
        task: "draft",
        status: "error",
        started_at: "2026-02-14T10:00:01.000Z",
        finished_at: "2026-02-14T10:00:02.000Z",
        duration_ms: 1000,
        error_code: "CONTRACT_OUTPUT_VIOLATION",
        error: "task output contract violation",
        contract_issues: [{ path: "claims", message: "expected array" }],
      },
    ],
    summary: {
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
    },
  };
}

test("createTrialSession derives expected diagnosis from trace", () => {
  const session = createTrialSession({
    participant: "p1",
    scenario: "quickstart-broken",
    mode: "condukt-ai",
    trace: buildBrokenTrace(),
    sessionId: "session-1",
    startedAt: "2026-02-14T10:00:00.000Z",
  });

  expect(session.session_id).toBe("session-1");
  expect(session.expected.task).toBe("draft");
  expect(session.expected.error_code).toBe("CONTRACT_OUTPUT_VIOLATION");
  expect(session.expected.contract_paths).toEqual(["claims"]);
});

test("completeTrialSession marks diagnosis accuracy", () => {
  const session = createTrialSession({
    participant: "p1",
    scenario: "quickstart-broken",
    mode: "condukt-ai",
    trace: buildBrokenTrace(),
    sessionId: "session-1",
    startedAt: "2026-02-14T10:00:00.000Z",
  });

  const record = completeTrialSession({
    session,
    diagnosed: {
      task: "draft",
      error_code: "CONTRACT_OUTPUT_VIOLATION",
    },
    finishedAt: "2026-02-14T10:00:30.000Z",
  });

  expect(record.elapsed_ms).toBe(30_000);
  expect(record.diagnosis_correct).toBe(true);
  expect(record.matched_task).toBe(true);
  expect(record.matched_error_code).toBe(true);
});

test("summarizeTrialRecords computes per-mode aggregates and speedup", () => {
  const records = [
    {
      session_id: "s1",
      participant: "p1",
      scenario: "quickstart-broken",
      mode: "condukt-ai",
      started_at: "2026-02-14T10:00:00.000Z",
      finished_at: "2026-02-14T10:00:20.000Z",
      elapsed_ms: 20_000,
      expected: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
        contract_paths: ["claims"],
      },
      diagnosed: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
      },
      matched_task: true,
      matched_error_code: true,
      diagnosis_correct: true,
    },
    {
      session_id: "s2",
      participant: "p1",
      scenario: "quickstart-broken",
      mode: "baseline",
      started_at: "2026-02-14T10:00:00.000Z",
      finished_at: "2026-02-14T10:01:20.000Z",
      elapsed_ms: 80_000,
      expected: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
        contract_paths: ["claims"],
      },
      diagnosed: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
      },
      matched_task: true,
      matched_error_code: true,
      diagnosis_correct: true,
    },
  ];

  const summary = summarizeTrialRecords(records);
  expect(summary.total).toBe(2);
  expect(summary.by_mode["condukt-ai"].total).toBe(1);
  expect(summary.by_mode.baseline.total).toBe(1);
  expect(summary.condukt_ai_vs_baseline_speedup).toBe(4);
  expect(summary.paired.total_pairs).toBe(1);
  expect(summary.paired.median_speedup).toBe(4);
  expect(summary.paired.p90_speedup).toBe(4);
  expect(summary.paired.pairs).toEqual([
    {
      participant: "p1",
      scenario: "quickstart-broken",
      baseline_elapsed_ms: 80_000,
      condukt_ai_elapsed_ms: 20_000,
      speedup: 4,
      baseline_correct: true,
      condukt_ai_correct: true,
    },
  ]);
});

test("summarizeTrialRecords pairs by participant and scenario using latest runs", () => {
  const records = [
    {
      session_id: "old-baseline",
      participant: "p1",
      scenario: "quickstart-broken",
      mode: "baseline",
      started_at: "2026-02-14T10:00:00.000Z",
      finished_at: "2026-02-14T10:00:30.000Z",
      elapsed_ms: 30_000,
      expected: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
        contract_paths: ["claims"],
      },
      diagnosed: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
      },
      matched_task: true,
      matched_error_code: true,
      diagnosis_correct: true,
    },
    {
      session_id: "new-baseline",
      participant: "p1",
      scenario: "quickstart-broken",
      mode: "baseline",
      started_at: "2026-02-14T10:00:00.000Z",
      finished_at: "2026-02-14T10:01:00.000Z",
      elapsed_ms: 60_000,
      expected: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
        contract_paths: ["claims"],
      },
      diagnosed: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
      },
      matched_task: true,
      matched_error_code: true,
      diagnosis_correct: true,
    },
    {
      session_id: "condukt-ai",
      participant: "p1",
      scenario: "quickstart-broken",
      mode: "condukt-ai",
      started_at: "2026-02-14T10:00:00.000Z",
      finished_at: "2026-02-14T10:00:20.000Z",
      elapsed_ms: 20_000,
      expected: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
        contract_paths: ["claims"],
      },
      diagnosed: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
      },
      matched_task: true,
      matched_error_code: true,
      diagnosis_correct: true,
    },
    {
      session_id: "unpaired",
      participant: "p2",
      scenario: "quickstart-broken",
      mode: "condukt-ai",
      started_at: "2026-02-14T10:00:00.000Z",
      finished_at: "2026-02-14T10:00:40.000Z",
      elapsed_ms: 40_000,
      expected: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
        contract_paths: ["claims"],
      },
      diagnosed: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
      },
      matched_task: true,
      matched_error_code: true,
      diagnosis_correct: true,
    },
  ];

  const summary = summarizeTrialRecords(records);
  expect(summary.paired.total_pairs).toBe(1);
  expect(summary.paired.median_speedup).toBe(3);
  expect(summary.paired.pairs[0]?.baseline_elapsed_ms).toBe(60_000);
  expect(summary.paired.pairs[0]?.condukt_ai_elapsed_ms).toBe(20_000);
});

test("evaluateTrialSummary passes when thresholds are met", () => {
  const summary = summarizeTrialRecords([
    {
      session_id: "s1",
      participant: "p1",
      scenario: "quickstart-broken",
      mode: "condukt-ai",
      started_at: "2026-02-14T10:00:00.000Z",
      finished_at: "2026-02-14T10:00:20.000Z",
      elapsed_ms: 20_000,
      expected: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
        contract_paths: ["claims"],
      },
      diagnosed: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
      },
      matched_task: true,
      matched_error_code: true,
      diagnosis_correct: true,
    },
    {
      session_id: "s2",
      participant: "p1",
      scenario: "quickstart-broken",
      mode: "baseline",
      started_at: "2026-02-14T10:00:00.000Z",
      finished_at: "2026-02-14T10:01:20.000Z",
      elapsed_ms: 80_000,
      expected: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
        contract_paths: ["claims"],
      },
      diagnosed: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
      },
      matched_task: true,
      matched_error_code: true,
      diagnosis_correct: true,
    },
  ]);

  const result = evaluateTrialSummary(summary, {
    min_records: 2,
    min_accuracy: 1,
    min_pairs: 1,
    min_paired_speedup: 2,
  });

  expect(result.pass).toBe(true);
  expect(result.failures).toEqual([]);
});

test("evaluateTrialSummary fails with actionable reasons", () => {
  const summary = summarizeTrialRecords([
    {
      session_id: "s1",
      participant: "p1",
      scenario: "quickstart-broken",
      mode: "condukt-ai",
      started_at: "2026-02-14T10:00:00.000Z",
      finished_at: "2026-02-14T10:00:30.000Z",
      elapsed_ms: 30_000,
      expected: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
        contract_paths: ["claims"],
      },
      diagnosed: {
        task: "wrong-task",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
      },
      matched_task: false,
      matched_error_code: true,
      diagnosis_correct: false,
    },
  ]);

  const result = evaluateTrialSummary(summary, {
    min_records: 2,
    min_accuracy: 0.8,
    min_pairs: 1,
    min_paired_speedup: 2,
  });

  expect(result.pass).toBe(false);
  expect(result.failures).toEqual([
    "records 1 < required 2",
    "accuracy 0.0% < required 80.0%",
    "paired samples 0 < required 1",
    "paired median speedup unavailable",
  ]);
});

test("renderTrialSummaryMarkdown includes summary and paired table", () => {
  const summary = summarizeTrialRecords([
    {
      session_id: "s1",
      participant: "p1",
      scenario: "quickstart-broken",
      mode: "condukt-ai",
      started_at: "2026-02-14T10:00:00.000Z",
      finished_at: "2026-02-14T10:00:20.000Z",
      elapsed_ms: 20_000,
      expected: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
        contract_paths: ["claims"],
      },
      diagnosed: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
      },
      matched_task: true,
      matched_error_code: true,
      diagnosis_correct: true,
    },
    {
      session_id: "s2",
      participant: "p1",
      scenario: "quickstart-broken",
      mode: "baseline",
      started_at: "2026-02-14T10:00:00.000Z",
      finished_at: "2026-02-14T10:01:20.000Z",
      elapsed_ms: 80_000,
      expected: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
        contract_paths: ["claims"],
      },
      diagnosed: {
        task: "draft",
        error_code: "CONTRACT_OUTPUT_VIOLATION",
      },
      matched_task: true,
      matched_error_code: true,
      diagnosis_correct: true,
    },
  ]);

  const markdown = renderTrialSummaryMarkdown(summary, {
    title: "Trial Snapshot",
    max_pairs: 10,
  });

  expect(markdown).toContain("# Trial Snapshot");
  expect(markdown).toContain("## Overview");
  expect(markdown).toContain("- Paired samples: 1");
  expect(markdown).toContain("## Paired Samples");
  expect(markdown).toContain("| p1 | quickstart-broken | 80000 ms | 20000 ms | 4.00x |");
});

test("normalizeTrialMode accepts legacy 'condukt' alias", () => {
  expect(normalizeTrialMode("baseline")).toBe("baseline");
  expect(normalizeTrialMode("condukt-ai")).toBe("condukt-ai");
  expect(normalizeTrialMode("condukt")).toBe("condukt-ai");
});

test("normalizeTrialRecord maps legacy mode and validates fields", () => {
  const normalized = normalizeTrialRecord({
    session_id: "s1",
    participant: "p1",
    scenario: "quickstart-broken",
    mode: "condukt",
    started_at: "2026-02-14T10:00:00.000Z",
    finished_at: "2026-02-14T10:00:10.000Z",
    elapsed_ms: 10_000,
    expected: {
      task: "draft",
      error_code: "CONTRACT_OUTPUT_VIOLATION",
      contract_paths: ["claims"],
    },
    diagnosed: {
      task: "draft",
      error_code: "CONTRACT_OUTPUT_VIOLATION",
    },
    matched_task: true,
    matched_error_code: true,
    diagnosis_correct: true,
  });

  expect(normalized.mode).toBe("condukt-ai");
  expect(normalized.expected.contract_paths).toEqual(["claims"]);
});

test("normalizeTrialRecord rejects malformed records", () => {
  expect(() =>
    normalizeTrialRecord({
      session_id: "s1",
      participant: "p1",
      scenario: "quickstart-broken",
      mode: "unknown",
      started_at: "2026-02-14T10:00:00.000Z",
      finished_at: "2026-02-14T10:00:10.000Z",
      elapsed_ms: 10_000,
      expected: {
        contract_paths: [],
      },
      diagnosed: {},
      matched_task: null,
      matched_error_code: null,
      diagnosis_correct: true,
    }),
  ).toThrow(/mode must be one of/);
});
