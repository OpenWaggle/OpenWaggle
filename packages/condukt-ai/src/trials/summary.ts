import type {
  TrialMode,
  TrialModeSummary,
  TrialPair,
  TrialPairSummary,
  TrialQualityGate,
  TrialQualityGateResult,
  TrialRecord,
  TrialSummary,
  TrialSummaryMarkdownOptions,
} from "./types.js";

/** Computes aggregate trial metrics, including paired speedup analysis. */
export function summarizeTrialRecords(records: readonly TrialRecord[]): TrialSummary {
  const byMode: Record<TrialMode, TrialRecord[]> = {
    "condukt-ai": [],
    baseline: [],
  };

  for (const record of records) {
    byMode[record.mode].push(record);
  }

  const conduktSummary = summarizeMode(byMode["condukt-ai"]);
  const baselineSummary = summarizeMode(byMode.baseline);
  const overall = summarizeMode(records);
  const paired = summarizePairs(records);

  return {
    ...overall,
    by_mode: {
      "condukt-ai": conduktSummary,
      baseline: baselineSummary,
    },
    condukt_ai_vs_baseline_speedup: computeSpeedup(
      baselineSummary.median_elapsed_ms,
      conduktSummary.median_elapsed_ms,
    ),
    paired,
  };
}

/** Applies minimum quality thresholds to a trial summary. */
export function evaluateTrialSummary(
  summary: TrialSummary,
  gate: TrialQualityGate,
): TrialQualityGateResult {
  const failures: string[] = [];

  if (typeof gate.min_records === "number" && summary.total < gate.min_records) {
    failures.push(`records ${summary.total} < required ${gate.min_records}`);
  }

  if (typeof gate.min_accuracy === "number" && summary.accuracy < gate.min_accuracy) {
    failures.push(
      `accuracy ${(summary.accuracy * 100).toFixed(1)}% < required ${(gate.min_accuracy * 100).toFixed(1)}%`,
    );
  }

  if (typeof gate.min_pairs === "number" && summary.paired.total_pairs < gate.min_pairs) {
    failures.push(`paired samples ${summary.paired.total_pairs} < required ${gate.min_pairs}`);
  }

  if (typeof gate.min_paired_speedup === "number") {
    if (summary.paired.median_speedup === null) {
      failures.push("paired median speedup unavailable");
    } else if (summary.paired.median_speedup < gate.min_paired_speedup) {
      failures.push(
        `paired median speedup ${summary.paired.median_speedup.toFixed(2)}x < required ${gate.min_paired_speedup.toFixed(2)}x`,
      );
    }
  }

  return {
    pass: failures.length === 0,
    failures,
  };
}

/**
 * Renders a markdown report from a computed trial summary.
 *
 * @example
 * ```ts
 * const markdown = renderTrialSummaryMarkdown(summary, { title: "Trial Report" });
 * ```
 */
export function renderTrialSummaryMarkdown(
  summary: TrialSummary,
  options: TrialSummaryMarkdownOptions = {},
): string {
  const title = options.title ?? "Condukt AI Trial Report";
  const maxPairs = Math.max(1, Math.floor(options.max_pairs ?? 20));
  const visiblePairs = summary.paired.pairs.slice(0, maxPairs);

  const lines: string[] = [
    `# ${title}`,
    "",
    "## Overview",
    "",
    `- Records: ${summary.total}`,
    `- Accuracy: ${formatPercent(summary.accuracy)}`,
    `- Median elapsed: ${formatMilliseconds(summary.median_elapsed_ms)}`,
    `- P90 elapsed: ${formatMilliseconds(summary.p90_elapsed_ms)}`,
    `- Global speedup (mode medians): ${formatSpeedup(summary.condukt_ai_vs_baseline_speedup)}`,
    `- Paired samples: ${summary.paired.total_pairs}`,
    `- Paired median speedup: ${formatSpeedup(summary.paired.median_speedup)}`,
    `- Paired p90 speedup: ${formatSpeedup(summary.paired.p90_speedup)}`,
    "",
    "## By Mode",
    "",
    "| Mode | Records | Accuracy | Median elapsed | P90 elapsed |",
    "| --- | ---: | ---: | ---: | ---: |",
    modeRow("condukt-ai", summary.by_mode["condukt-ai"]),
    modeRow("baseline", summary.by_mode.baseline),
  ];

  if (visiblePairs.length > 0) {
    lines.push(
      "",
      "## Paired Samples",
      "",
      "| Participant | Scenario | Baseline elapsed | Condukt AI elapsed | Speedup |",
      "| --- | --- | ---: | ---: | ---: |",
      ...visiblePairs.map(
        (pair) =>
          `| ${pair.participant} | ${pair.scenario} | ${pair.baseline_elapsed_ms} ms | ${pair.condukt_ai_elapsed_ms} ms | ${pair.speedup.toFixed(2)}x |`,
      ),
    );

    if (summary.paired.pairs.length > visiblePairs.length) {
      lines.push(
        "",
        `... ${summary.paired.pairs.length - visiblePairs.length} more pair(s) omitted.`,
      );
    }
  } else {
    lines.push("", "## Paired Samples", "", "_No paired samples available._");
  }

  lines.push("");
  return lines.join("\n");
}

function summarizeMode(records: readonly TrialRecord[]): TrialModeSummary {
  if (records.length === 0) {
    return {
      total: 0,
      correct: 0,
      accuracy: 0,
      median_elapsed_ms: null,
      p90_elapsed_ms: null,
    };
  }

  const correct = records.filter((record) => record.diagnosis_correct).length;
  const elapsed = records.map((record) => record.elapsed_ms).sort((left, right) => left - right);

  return {
    total: records.length,
    correct,
    accuracy: correct / records.length,
    median_elapsed_ms: quantile(elapsed, 0.5),
    p90_elapsed_ms: quantile(elapsed, 0.9),
  };
}

function summarizePairs(records: readonly TrialRecord[]): TrialPairSummary {
  const pairs = buildPairs(records);
  const speedups = pairs.map((pair) => pair.speedup).sort((left, right) => left - right);

  return {
    total_pairs: pairs.length,
    median_speedup: quantile(speedups, 0.5),
    p90_speedup: quantile(speedups, 0.9),
    pairs,
  };
}

function buildPairs(records: readonly TrialRecord[]): TrialPair[] {
  interface PairBucket {
    baseline?: TrialRecord;
    conduktAi?: TrialRecord;
  }

  const buckets = new Map<string, PairBucket>();
  for (const record of records) {
    const key = `${record.participant}::${record.scenario}`;
    const bucket = buckets.get(key) ?? {};

    if (record.mode === "baseline") {
      bucket.baseline = pickLatestRecord(bucket.baseline, record);
    } else {
      bucket.conduktAi = pickLatestRecord(bucket.conduktAi, record);
    }

    buckets.set(key, bucket);
  }

  const pairs: TrialPair[] = [];
  for (const [key, bucket] of buckets.entries()) {
    if (!bucket.baseline || !bucket.conduktAi) {
      continue;
    }

    if (bucket.conduktAi.elapsed_ms <= 0) {
      continue;
    }

    const [participant, scenario] = splitPairKey(key);
    pairs.push({
      participant,
      scenario,
      baseline_elapsed_ms: bucket.baseline.elapsed_ms,
      condukt_ai_elapsed_ms: bucket.conduktAi.elapsed_ms,
      speedup: bucket.baseline.elapsed_ms / bucket.conduktAi.elapsed_ms,
      baseline_correct: bucket.baseline.diagnosis_correct,
      condukt_ai_correct: bucket.conduktAi.diagnosis_correct,
    });
  }

  return pairs.sort((left, right) => {
    if (left.participant !== right.participant) {
      return left.participant.localeCompare(right.participant);
    }
    return left.scenario.localeCompare(right.scenario);
  });
}

function pickLatestRecord(current: TrialRecord | undefined, next: TrialRecord): TrialRecord {
  if (!current) {
    return next;
  }

  const currentMs = new Date(current.finished_at).getTime();
  const nextMs = new Date(next.finished_at).getTime();
  return nextMs >= currentMs ? next : current;
}

function splitPairKey(key: string): [string, string] {
  const separator = key.indexOf("::");
  if (separator < 0) {
    return [key, ""];
  }

  return [key.slice(0, separator), key.slice(separator + 2)];
}

function modeRow(mode: TrialMode, summary: TrialModeSummary): string {
  return `| ${mode} | ${summary.total} | ${formatPercent(summary.accuracy)} | ${formatMilliseconds(summary.median_elapsed_ms)} | ${formatMilliseconds(summary.p90_elapsed_ms)} |`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMilliseconds(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return `${value} ms`;
}

function formatSpeedup(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return `${value.toFixed(2)}x`;
}

function computeSpeedup(
  baselineMedianMs: number | null,
  conduktAiMedianMs: number | null,
): number | null {
  if (baselineMedianMs === null || conduktAiMedianMs === null || conduktAiMedianMs <= 0) {
    return null;
  }

  return baselineMedianMs / conduktAiMedianMs;
}

function quantile(sortedValues: readonly number[], q: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const index = Math.ceil(q * sortedValues.length) - 1;
  const clamped = Math.min(sortedValues.length - 1, Math.max(0, index));
  return sortedValues[clamped] ?? null;
}
