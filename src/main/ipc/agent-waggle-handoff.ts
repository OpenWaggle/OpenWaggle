import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { WaggleHandoffRequest, WaggleInvocation } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { classifyAgentError } from '../agent/error-classifier'
import { executeWaggleRun } from '../application/waggle-run-service'
import { broadcastToWindows } from '../utils/broadcast'
import {
  emitTransportEvent,
  emitWaggleTransportEvent,
  emitWaggleTurnEvent,
  startStreamBuffer,
} from '../utils/stream-bridge'
import { emitErrorAndFinish } from './run-handler-utils'

function waggleInvocationFromHandoff(handoff: WaggleHandoffRequest): WaggleInvocation {
  return {
    presetId: handoff.presetId,
    presetName: handoff.presetName,
    source: handoff.source,
    config: handoff.config,
  }
}

function emitWaggleRunEnd(sessionId: SessionId, runId: string, reason: 'aborted' | 'stop') {
  emitTransportEvent(sessionId, { type: 'agent_end', timestamp: Date.now(), runId, reason })
}

export function runAgentRequestedWaggle(input: {
  readonly sessionId: SessionId
  readonly handoff: WaggleHandoffRequest
  readonly model: SupportedModelId
  readonly thinkingLevel: AgentSendPayload['thinkingLevel']
  readonly abortController: AbortController
}) {
  return Effect.gen(function* () {
    const invocation = waggleInvocationFromHandoff(input.handoff)
    yield* Effect.sync(() => {
      emitWaggleTurnEvent(input.sessionId, {
        type: 'collaboration-pending',
        sessionId: input.sessionId,
        invocation,
      })
    })

    const runId = `waggle-${input.sessionId}`
    const result = yield* executeWaggleRun({
      sessionId: input.sessionId,
      runId,
      payload: {
        text: input.handoff.prompt,
        thinkingLevel: input.thinkingLevel,
        attachments: [],
        waggle: invocation,
      },
      model: input.model,
      config: input.handoff.config,
      signal: input.abortController.signal,
      onRunPrepared: (runtimeModel) => {
        startStreamBuffer(input.sessionId, runtimeModel, 'waggle')
        emitTransportEvent(input.sessionId, {
          type: 'agent_start',
          timestamp: Date.now(),
          runId,
        })
      },
      onEvent: (event, meta) => {
        emitWaggleTransportEvent(input.sessionId, event, meta)
        if (event.type !== 'agent_end') emitTransportEvent(input.sessionId, event)
      },
      onTurnEvent: (event) => emitWaggleTurnEvent(input.sessionId, event),
      onTitleAssigned: (title) => {
        broadcastToWindows('sessions:title-updated', { sessionId: input.sessionId, title })
      },
    })

    matchBy(result, 'outcome')
      .with('validation-error', 'not-found', 'no-project', (value) =>
        emitErrorAndFinish(input.sessionId, value.message, value.code, runId),
      )
      .with('aborted', () => emitWaggleRunEnd(input.sessionId, runId, 'aborted'))
      .with('success', (value) => {
        const assistantCount = value.newMessages.filter(
          (message) => message.role === 'assistant',
        ).length
        if (assistantCount === 0 && value.lastError) {
          const classified = classifyAgentError(new Error(value.lastError))
          emitErrorAndFinish(input.sessionId, classified.userMessage, classified.code, runId)
          return
        }
        emitWaggleRunEnd(input.sessionId, runId, 'stop')
      })
      .exhaustive()
  })
}
