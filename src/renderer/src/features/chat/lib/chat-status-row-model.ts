import type { AgentTransportCustomEvent } from '@shared/types/stream'
import type { StreamingPhaseState } from '../hooks/useStreamingPhase'
import type { AgentCompactionStatus } from './compaction-lifecycle'
import type { ChatRow } from './types-chat-row'

interface StatusRowInput {
  readonly phase: StreamingPhaseState
  readonly isLoading: boolean
  /** The agent ended the Run and the Host is still settling it (see `run-finishing-store`). */
  readonly isFinishing?: boolean
  readonly error: Error | undefined
  readonly lastUserMessage: string | null
  readonly dismissedError: string | null
  readonly sessionId: string | null
  readonly compactionStatus?: AgentCompactionStatus | null
  /**
   * A new Session's first message was sent and nothing has reported back yet: no launch step, no
   * run. The Host may be creating the Session or building the runtime; say so instead of nothing.
   */
  readonly awaitingFirstRun?: boolean
}

// A failed Run shows its error while it settles; a clean one says it is being wrapped up.
function appendFinishingRow(rows: ChatRow[], input: StatusRowInput) {
  if (!input.isFinishing || input.phase.current || input.isLoading || input.error) return
  rows.push({ type: 'phase-indicator', label: 'Finishing', elapsedMs: 0 })
}

export function appendStatusRows(rows: ChatRow[], input: StatusRowInput) {
  if (input.compactionStatus?.type === 'retrying') {
    rows.push({
      type: 'retry-status',
      attempt: input.compactionStatus.attempt,
      maxAttempts: input.compactionStatus.maxAttempts,
      delayMs: input.compactionStatus.delayMs,
    })
    return
  }
  if (input.compactionStatus?.type === 'compacting') return
  if (input.phase.current) {
    rows.push({
      type: 'phase-indicator',
      label: input.phase.current.label,
      elapsedMs: input.phase.current.elapsedMs,
    })
  }
  if (!input.phase.current && input.isLoading) {
    rows.push({
      type: 'phase-indicator',
      label: 'Thinking',
      elapsedMs: input.phase.totalElapsedMs,
    })
  }
  appendFinishingRow(rows, input)
  if (!input.phase.current && !input.isLoading && !input.error && input.awaitingFirstRun) {
    rows.push({ type: 'phase-indicator', label: 'Starting session', elapsedMs: 0 })
  }
  if (input.error && !input.isLoading) {
    rows.push({
      type: 'error',
      error: input.error,
      lastUserMessage: input.lastUserMessage,
      dismissedError: input.dismissedError,
      sessionId: input.sessionId,
    })
  }
}

export function appendCustomMessageRows(
  rows: ChatRow[],
  customMessages: readonly AgentTransportCustomEvent[],
) {
  for (const event of customMessages) rows.push({ type: 'agent-loop-custom-message', event })
}
