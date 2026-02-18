import type { PipelineTrace } from "../pipeline.js";

/** Trial mode labels used for diagnosis studies. */
export type TrialMode = "condukt-ai" | "baseline";

/** Expected failure boundary for a trial session. */
export interface TrialExpectation {
  readonly task?: string;
  readonly error_code?: string;
  readonly contract_paths: readonly string[];
}

/** In-progress trial session metadata. */
export interface TrialSession {
  readonly session_id: string;
  readonly participant: string;
  readonly scenario: string;
  readonly mode: TrialMode;
  readonly started_at: string;
  readonly expected: TrialExpectation;
  readonly pipeline?: string;
}

/** Completed trial record with measured diagnosis outcome. */
export interface TrialRecord {
  readonly session_id: string;
  readonly participant: string;
  readonly scenario: string;
  readonly mode: TrialMode;
  readonly started_at: string;
  readonly finished_at: string;
  readonly elapsed_ms: number;
  readonly expected: TrialExpectation;
  readonly diagnosed: {
    readonly task?: string;
    readonly error_code?: string;
  };
  readonly matched_task: boolean | null;
  readonly matched_error_code: boolean | null;
  readonly diagnosis_correct: boolean;
  readonly notes?: string;
}

/** Input payload for starting a trial session. */
export interface CreateTrialSessionInput {
  readonly participant: string;
  readonly scenario: string;
  readonly mode: TrialMode;
  readonly trace?: PipelineTrace;
  readonly expected?: {
    readonly task?: string;
    readonly error_code?: string;
    readonly contract_paths?: readonly string[];
  };
  readonly sessionId?: string;
  readonly startedAt?: string;
}

/** Input payload for completing a trial session. */
export interface CompleteTrialSessionInput {
  readonly session: TrialSession;
  readonly diagnosed: {
    readonly task?: string;
    readonly error_code?: string;
  };
  readonly notes?: string;
  readonly finishedAt?: string;
}

/** Aggregate summary metrics across trial records. */
export interface TrialSummary {
  readonly total: number;
  readonly correct: number;
  readonly accuracy: number;
  readonly median_elapsed_ms: number | null;
  readonly p90_elapsed_ms: number | null;
  readonly by_mode: Record<TrialMode, TrialModeSummary>;
  readonly condukt_ai_vs_baseline_speedup: number | null;
  readonly paired: TrialPairSummary;
}

/** Per-mode summary metrics. */
export interface TrialModeSummary {
  readonly total: number;
  readonly correct: number;
  readonly accuracy: number;
  readonly median_elapsed_ms: number | null;
  readonly p90_elapsed_ms: number | null;
}

/** Participant/scenario baseline-vs-condukt paired comparison. */
export interface TrialPair {
  readonly participant: string;
  readonly scenario: string;
  readonly baseline_elapsed_ms: number;
  readonly condukt_ai_elapsed_ms: number;
  readonly speedup: number;
  readonly baseline_correct: boolean;
  readonly condukt_ai_correct: boolean;
}

/** Summary of paired speedup calculations. */
export interface TrialPairSummary {
  readonly total_pairs: number;
  readonly median_speedup: number | null;
  readonly p90_speedup: number | null;
  readonly pairs: readonly TrialPair[];
}

/** Optional quality thresholds for trial result evaluation. */
export interface TrialQualityGate {
  readonly min_records?: number;
  readonly min_accuracy?: number;
  readonly min_pairs?: number;
  readonly min_paired_speedup?: number;
}

/** Evaluation result returned by trial quality gates. */
export interface TrialQualityGateResult {
  readonly pass: boolean;
  readonly failures: readonly string[];
}

/** Markdown rendering options for trial summary reports. */
export interface TrialSummaryMarkdownOptions {
  readonly title?: string;
  readonly max_pairs?: number;
}
