import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentSendReport } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { AgentRunResult } from '../application/agent-run-service'
import { emitErrorAndFinish } from './run-handler-utils'

/** Translate the application's richer run outcome into the renderer delivery contract. */
export function describeSendOutcome(result: AgentRunResult): AgentSendReport {
  return matchBy(result, 'outcome')
    .with('success', () => ({ outcome: 'delivered' as const }))
    .with('aborted', () => ({ outcome: 'cancelled' as const }))
    .with('error', (value) =>
      value.transportEmitted === true
        ? { outcome: 'delivered' as const }
        : {
            outcome: 'refused' as const,
            ...(value.message === undefined ? {} : { message: value.message }),
            ...(value.code === undefined ? {} : { code: value.code }),
          },
    )
    .otherwise((value) => ({
      outcome: 'refused' as const,
      ...(value.message === undefined ? {} : { message: value.message }),
      ...(value.code === undefined ? {} : { code: value.code }),
    }))
}

export function handleRunResult(sessionId: SessionId, result: AgentRunResult) {
  if (result.outcome === 'error' && result.transportEmitted) return

  matchBy(result, 'outcome')
    .with('success', 'aborted', () => undefined)
    .with('invalid-model', 'not-found', 'error', (value) =>
      emitErrorAndFinish(sessionId, value.message, value.code),
    )
    .exhaustive()
}
