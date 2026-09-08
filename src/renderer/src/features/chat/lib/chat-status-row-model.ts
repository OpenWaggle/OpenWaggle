import type { AgentTransportCustomEvent } from '@shared/types/stream'
import type { StreamingPhaseState } from '../hooks/useStreamingPhase'
import type { ChatRow } from './types-chat-row'

interface StatusRowInput {
  readonly phase: StreamingPhaseState
  readonly isLoading: boolean
  readonly error: Error | undefined
  readonly lastUserMessage: string | null
  readonly dismissedError: string | null
  readonly sessionId: string | null
}

export function appendStatusRows(rows: ChatRow[], input: StatusRowInput) {
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
  if (!input.isLoading && !input.phase.current && input.phase.completed.length > 0) {
    rows.push({
      type: 'run-summary',
      phases: input.phase.completed,
      totalMs: input.phase.totalElapsedMs,
    })
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
