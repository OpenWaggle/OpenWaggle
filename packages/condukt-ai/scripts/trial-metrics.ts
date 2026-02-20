import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { PipelineTrace } from "../src/pipeline.js";
import {
  completeTrialSession,
  createTrialSession,
  evaluateTrialSummary,
  normalizeTrialMode,
  normalizeTrialRecord,
  renderTrialSummaryMarkdown,
  summarizeTrialRecords,
  type TrialMode,
  type TrialQualityGate,
  type TrialQualityGateResult,
  type TrialRecord,
  type TrialSession,
  type TrialSummary,
} from "../src/trials.js";

const DEFAULT_TRIAL_DATA = "trials/diagnosis-metrics.jsonl";
const DEFAULT_SESSION_DIR = "trials/sessions";

type TrialCommand = "start" | "finish" | "report";
type FlagValue = string | true;

type FlagMap = ReadonlyMap<string, FlagValue>;

interface ParsedCommand {
  readonly command: TrialCommand;
  readonly flags: Map<string, FlagValue>;
}

interface StartOptions {
  readonly participant: string;
  readonly scenario: string;
  readonly mode: TrialMode;
  readonly rawMode: string;
  readonly tracePath?: string;
  readonly expectedTask?: string;
  readonly expectedErrorCode?: string;
  readonly expectedContractPaths: readonly string[];
  readonly sessionOut?: string;
}

interface FinishOptions {
  readonly sessionPath: string;
  readonly outPath: string;
  readonly diagnosedTask?: string;
  readonly diagnosedErrorCode?: string;
  readonly notes?: string;
}

interface ReportOptions {
  readonly inputPath: string;
  readonly json: boolean;
  readonly markdownOut?: string;
  readonly title?: string;
  readonly maxPairs?: number;
  readonly gate: TrialQualityGate;
}

async function main(): Promise<void> {
  const parsed = parseCommand(process.argv.slice(2));

  if (parsed.command === "start") {
    await runStart(parseStartOptions(parsed.flags));
    return;
  }

  if (parsed.command === "finish") {
    await runFinish(parseFinishOptions(parsed.flags));
    return;
  }

  await runReport(parseReportOptions(parsed.flags));
}

async function runStart(options: StartOptions): Promise<void> {
  if (options.rawMode === "condukt") {
    console.log("Mode alias 'condukt' is deprecated; normalized to 'condukt-ai'.");
  }

  const trace = options.tracePath
    ? await readJson<PipelineTrace>(resolve(process.cwd(), options.tracePath))
    : undefined;

  const session = createTrialSession({
    participant: options.participant,
    scenario: options.scenario,
    mode: options.mode,
    trace,
    expected: {
      task: options.expectedTask,
      error_code: options.expectedErrorCode,
      contract_paths: options.expectedContractPaths,
    },
  });

  const outputPath = options.sessionOut
    ? resolve(process.cwd(), options.sessionOut)
    : resolve(process.cwd(), DEFAULT_SESSION_DIR, `${session.session_id}.session.json`);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(session, null, 2)}\n`, "utf-8");

  console.log(`Session started: ${session.session_id}`);
  console.log(`Session file: ${outputPath}`);
  console.log(`Expected task: ${session.expected.task ?? "<unspecified>"}`);
  console.log(`Expected error code: ${session.expected.error_code ?? "<unspecified>"}`);
}

async function runFinish(options: FinishOptions): Promise<void> {
  const session = await readJson<TrialSession>(resolve(process.cwd(), options.sessionPath));
  const record = completeTrialSession({
    session,
    diagnosed: {
      task: options.diagnosedTask,
      error_code: options.diagnosedErrorCode,
    },
    notes: options.notes,
  });

  const outputPath = resolve(process.cwd(), options.outPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf-8");

  console.log(`Session finished: ${record.session_id}`);
  console.log(`Elapsed ms: ${record.elapsed_ms}`);
  console.log(`Diagnosis correct: ${record.diagnosis_correct}`);
  console.log(`Metrics file: ${outputPath}`);
}

async function runReport(options: ReportOptions): Promise<void> {
  const inputPath = resolve(process.cwd(), options.inputPath);
  const records = await readAndNormalizeTrialRecords(inputPath);
  const summary = summarizeTrialRecords(records);
  const hasGate = hasGateConfiguration(options.gate);
  const gateResult = hasGate ? evaluateTrialSummary(summary, options.gate) : undefined;

  await maybeWriteMarkdownReport(options, summary, gateResult);

  if (options.json) {
    if (hasGate) {
      console.log(
        JSON.stringify(
          {
            summary,
            gate: {
              config: options.gate,
              result: gateResult ?? { pass: true, failures: [] },
            },
          },
          null,
          2,
        ),
      );
      if (gateResult && !gateResult.pass) {
        process.exitCode = 1;
      }
      return;
    }

    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`Records: ${summary.total}`);
  console.log(`Correct: ${summary.correct}`);
  console.log(`Accuracy: ${(summary.accuracy * 100).toFixed(1)}%`);
  console.log(`Median elapsed ms: ${summary.median_elapsed_ms ?? "n/a"}`);
  console.log(`P90 elapsed ms: ${summary.p90_elapsed_ms ?? "n/a"}`);
  console.log(
    `Condukt AI vs baseline speedup (median): ${
      summary.condukt_ai_vs_baseline_speedup
        ? `${summary.condukt_ai_vs_baseline_speedup.toFixed(2)}x`
        : "n/a"
    }`,
  );
  console.log(`Paired samples: ${summary.paired.total_pairs}`);
  console.log(
    `Paired speedup (median): ${
      summary.paired.median_speedup ? `${summary.paired.median_speedup.toFixed(2)}x` : "n/a"
    }`,
  );

  if (hasGate) {
    console.log(`Gate status: ${gateResult?.pass ? "PASS" : "FAIL"}`);
    for (const failure of gateResult?.failures ?? []) {
      console.log(`- ${failure}`);
    }
    if (gateResult && !gateResult.pass) {
      process.exitCode = 1;
    }
  }
}

function parseCommand(argv: readonly string[]): ParsedCommand {
  const commandToken = argv[0];
  if (!commandToken || !isTrialCommand(commandToken)) {
    printUsage();
    throw new Error("missing command (expected: start, finish, report)");
  }

  const flags = parseFlags(argv.slice(1));
  validateFlagsForCommand(commandToken, flags);
  return {
    command: commandToken,
    flags,
  };
}

function isTrialCommand(value: string): value is TrialCommand {
  return value === "start" || value === "finish" || value === "report";
}

function parseFlags(tokens: readonly string[]): Map<string, FlagValue> {
  const parsed = new Map<string, FlagValue>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    if (!key) {
      throw new Error("empty flag name is not allowed");
    }

    if (parsed.has(key)) {
      throw new Error(`duplicate flag: --${key}`);
    }

    const nextToken = tokens[index + 1];
    if (!nextToken || nextToken.startsWith("--")) {
      parsed.set(key, true);
      continue;
    }

    parsed.set(key, nextToken);
    index += 1;
  }

  return parsed;
}

function validateFlagsForCommand(command: TrialCommand, flags: FlagMap): void {
  const allowedByCommand: Record<TrialCommand, readonly string[]> = {
    start: [
      "participant",
      "scenario",
      "mode",
      "trace",
      "expected-task",
      "expected-error-code",
      "expected-contract-paths",
      "session-out",
    ],
    finish: ["session", "diagnosed-task", "diagnosed-error-code", "out", "notes"],
    report: [
      "input",
      "json",
      "markdown-out",
      "title",
      "max-pairs",
      "min-records",
      "min-accuracy",
      "min-pairs",
      "min-speedup",
    ],
  };

  const allowed = new Set(allowedByCommand[command]);
  for (const key of flags.keys()) {
    if (!allowed.has(key)) {
      throw new Error(`unknown --${key} for '${command}' command`);
    }
  }
}

function parseStartOptions(flags: FlagMap): StartOptions {
  const rawMode = requiredStringFlag(flags, "mode");

  return {
    participant: requiredStringFlag(flags, "participant"),
    scenario: requiredStringFlag(flags, "scenario"),
    mode: normalizeTrialMode(rawMode),
    rawMode,
    tracePath: optionalStringFlag(flags, "trace"),
    expectedTask: optionalStringFlag(flags, "expected-task"),
    expectedErrorCode: optionalStringFlag(flags, "expected-error-code"),
    expectedContractPaths: splitList(optionalStringFlag(flags, "expected-contract-paths")),
    sessionOut: optionalStringFlag(flags, "session-out"),
  };
}

function parseFinishOptions(flags: FlagMap): FinishOptions {
  return {
    sessionPath: requiredStringFlag(flags, "session"),
    outPath: optionalStringFlag(flags, "out") ?? DEFAULT_TRIAL_DATA,
    diagnosedTask: optionalStringFlag(flags, "diagnosed-task"),
    diagnosedErrorCode: optionalStringFlag(flags, "diagnosed-error-code"),
    notes: optionalStringFlag(flags, "notes"),
  };
}

function parseReportOptions(flags: FlagMap): ReportOptions {
  return {
    inputPath: optionalStringFlag(flags, "input") ?? DEFAULT_TRIAL_DATA,
    json: booleanFlag(flags, "json"),
    markdownOut: optionalStringFlag(flags, "markdown-out"),
    title: optionalStringFlag(flags, "title"),
    maxPairs: parseOptionalInt(optionalStringFlag(flags, "max-pairs"), "max-pairs"),
    gate: {
      min_records: parseOptionalInt(optionalStringFlag(flags, "min-records"), "min-records"),
      min_accuracy: parseOptionalRatio(optionalStringFlag(flags, "min-accuracy"), "min-accuracy"),
      min_pairs: parseOptionalInt(optionalStringFlag(flags, "min-pairs"), "min-pairs"),
      min_paired_speedup: parseOptionalFloat(
        optionalStringFlag(flags, "min-speedup"),
        "min-speedup",
      ),
    },
  };
}

function requiredStringFlag(flags: FlagMap, key: string): string {
  const value = optionalStringFlag(flags, key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

function optionalStringFlag(flags: FlagMap, key: string): string | undefined {
  const value = flags.get(key);
  if (typeof value === "undefined") {
    return undefined;
  }

  if (value === true) {
    throw new Error(`missing value for --${key}`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`empty value for --${key}`);
  }

  return normalized;
}

function booleanFlag(flags: FlagMap, key: string): boolean {
  const value = flags.get(key);
  if (typeof value === "undefined") {
    return false;
  }

  if (value !== true) {
    throw new Error(`--${key} does not accept a value`);
  }

  return true;
}

function hasGateConfiguration(gate: TrialQualityGate): boolean {
  return (
    typeof gate.min_records === "number" ||
    typeof gate.min_accuracy === "number" ||
    typeof gate.min_pairs === "number" ||
    typeof gate.min_paired_speedup === "number"
  );
}

function parseOptionalInt(value: string | undefined, field: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`invalid --${field}, expected non-negative integer`);
  }
  return parsed;
}

function parseOptionalFloat(value: string | undefined, field: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid --${field}, expected non-negative number`);
  }
  return parsed;
}

function parseOptionalRatio(value: string | undefined, field: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`invalid --${field}, expected number between 0 and 1`);
  }
  return parsed;
}

function splitList(value: string | undefined): readonly string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function readJson<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as T;
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  const content = await readFile(path, "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

async function readAndNormalizeTrialRecords(path: string): Promise<TrialRecord[]> {
  const records = await readJsonLines<unknown>(path);
  return records.map((record, index) => {
    try {
      return normalizeTrialRecord(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`invalid trial record at line ${index + 1}: ${message}`);
    }
  });
}

async function maybeWriteMarkdownReport(
  options: ReportOptions,
  summary: TrialSummary,
  gateResult: TrialQualityGateResult | undefined,
): Promise<void> {
  if (!options.markdownOut) {
    return;
  }

  let markdown = renderTrialSummaryMarkdown(summary, {
    ...(options.title ? { title: options.title } : {}),
    ...(typeof options.maxPairs === "number" ? { max_pairs: options.maxPairs } : {}),
  });

  if (gateResult) {
    markdown += "\n## Gate\n\n";
    markdown += `- Status: ${gateResult.pass ? "PASS" : "FAIL"}\n`;
    if (gateResult.failures.length > 0) {
      markdown += "\n";
      for (const failure of gateResult.failures) {
        markdown += `- ${failure}\n`;
      }
    }
  }

  const outputPath = resolve(process.cwd(), options.markdownOut);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, "utf-8");
  console.log(`Markdown report: ${outputPath}`);
}

function printUsage(): void {
  console.log(
    "Usage:\n" +
      "  trial-metrics.ts start --participant <id> --scenario <name> --mode <condukt-ai|condukt|baseline> [--trace <trace.json>]\n" +
      "  trial-metrics.ts finish --session <session.json> [--diagnosed-task <id>] [--diagnosed-error-code <code>] [--out <metrics.jsonl>]\n" +
      "  trial-metrics.ts report [--input <metrics.jsonl>] [--json] [--markdown-out <file.md>] [--title <text>] [--max-pairs <int>] [--min-records <int>] [--min-accuracy <0..1>] [--min-pairs <int>] [--min-speedup <number>]",
  );
}

main().catch((error) => {
  printUsage();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
