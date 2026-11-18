/** One token-usage record Pi wrote into a session file, as the Usage & Cost view reads it. */
export interface UsageCostRecordTokens {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

export interface UsageCostRecord {
  readonly timestampMs: number
  readonly provider: string
  readonly modelId: string
  readonly tokens: UsageCostRecordTokens
  readonly totalTokens: number
  /** Cost Pi wrote into the session record, or `null` when absent. */
  readonly recordedCostUsd: number | null
  /** Cost computed from Pi's own model rates when the record carried none. */
  readonly estimatedCostUsd: number | null
}
