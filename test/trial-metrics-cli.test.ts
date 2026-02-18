import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import type { PipelineTrace } from "../src/pipeline.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(TEST_DIR, "..");
const TRIAL_METRICS_SCRIPT = resolve(PACKAGE_ROOT, "scripts", "trial-metrics.ts");

interface CliRunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface ReportSummary {
  readonly total: number;
  readonly by_mode: {
    readonly "condukt-ai": {
      readonly total: number;
    };
    readonly baseline: {
      readonly total: number;
    };
  };
}

test("trial metrics CLI supports start/finish/report workflow", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "condukt-ai-trials-"));
  try {
    const tracePath = join(workspace, "broken-trace.json");
    const conduktSessionPath = join(workspace, "condukt.session.json");
    const baselineSessionPath = join(workspace, "baseline.session.json");
    const metricsPath = join(workspace, "metrics.jsonl");

    await writeFile(tracePath, JSON.stringify(buildBrokenTrace(), null, 2), "utf-8");

    const startCondukt = runTrialMetrics(
      [
        "start",
        "--participant",
        "p1",
        "--scenario",
        "broken-quickstart",
        "--mode",
        "condukt",
        "--trace",
        tracePath,
        "--session-out",
        conduktSessionPath,
      ],
      PACKAGE_ROOT,
    );
    expect(startCondukt.status).toBe(0);
    expect(startCondukt.stdout).toContain("normalized to 'condukt-ai'");

    const finishCondukt = runTrialMetrics(
      [
        "finish",
        "--session",
        conduktSessionPath,
        "--diagnosed-task",
        "draft",
        "--diagnosed-error-code",
        "CONTRACT_OUTPUT_VIOLATION",
        "--out",
        metricsPath,
      ],
      PACKAGE_ROOT,
    );
    expect(finishCondukt.status).toBe(0);

    const startBaseline = runTrialMetrics(
      [
        "start",
        "--participant",
        "p1",
        "--scenario",
        "broken-quickstart",
        "--mode",
        "baseline",
        "--expected-task",
        "draft",
        "--expected-error-code",
        "CONTRACT_OUTPUT_VIOLATION",
        "--session-out",
        baselineSessionPath,
      ],
      PACKAGE_ROOT,
    );
    expect(startBaseline.status).toBe(0);

    const baselineSession = JSON.parse(await readFile(baselineSessionPath, "utf-8")) as {
      started_at?: string;
    };
    baselineSession.started_at = "2026-02-14T10:00:00.000Z";
    await writeFile(
      `${baselineSessionPath}`,
      `${JSON.stringify(baselineSession, null, 2)}\n`,
      "utf-8",
    );

    const finishBaseline = runTrialMetrics(
      [
        "finish",
        "--session",
        baselineSessionPath,
        "--diagnosed-task",
        "draft",
        "--diagnosed-error-code",
        "CONTRACT_OUTPUT_VIOLATION",
        "--out",
        metricsPath,
      ],
      PACKAGE_ROOT,
    );
    expect(finishBaseline.status).toBe(0);

    const report = runTrialMetrics(["report", "--input", metricsPath, "--json"], PACKAGE_ROOT);
    expect(report.status).toBe(0);

    const payload = JSON.parse(report.stdout) as ReportSummary;
    expect(payload.total).toBe(2);
    expect(payload.by_mode["condukt-ai"].total).toBe(1);
    expect(payload.by_mode.baseline.total).toBe(1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("trial metrics CLI rejects value for boolean --json flag", () => {
  const result = runTrialMetrics(["report", "--json", "true"], PACKAGE_ROOT);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("--json does not accept a value");
});

function runTrialMetrics(args: readonly string[], cwd: string): CliRunResult {
  const result = spawnSync("pnpm", ["exec", "tsx", TRIAL_METRICS_SCRIPT, ...args], {
    cwd,
    encoding: "utf-8",
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

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
