import type { TruthEntry } from './transcript-order.persisted'

/*
 * Log entries the Host model appends that no Run streams: a compaction summary, and the history a
 * Session held before the test, which the transcript shows above its compaction marker (ADR 0048).
 */

export const HISTORY_RUN_ID = 'history'

/** Texts later Runs repeat: a prompt or answer matched by text must not take one of these. */
const HISTORY_TEXTS = ['continue', 'Done.', 'ok', 'ok', 'continue', 'Done.']

export function historyEntries(): Array<Omit<TruthEntry, 'order' | 'runId' | 'timestamp'>> {
  return HISTORY_TEXTS.map((text, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text,
    liveId: `live-history-${String(index)}`,
    piId: `pi-history-${String(index)}`,
    toolCallIds: [],
  }))
}

/** The summary entry of a compaction, the `index`th log entry. */
export function summaryEntry(
  index: number,
  entry: Pick<TruthEntry, 'order' | 'runId' | 'timestamp'>,
): TruthEntry {
  return {
    role: 'assistant',
    text: `Compaction summary\n\nsummary ${String(index)}`,
    liveId: `live-summary-${String(index)}`,
    piId: `pi-summary-${String(index)}`,
    ...entry,
    toolCallIds: [],
    compactionSummary: true,
  }
}
