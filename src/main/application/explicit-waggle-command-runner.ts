import type { toAgentSendPayload } from '@shared/schemas/validation'
import type { toWaggleConfig } from '@shared/schemas/waggle'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { emitWorktreeLaunchFailure, emitWorktreeLaunchProgress } from '../utils/stream-bridge'
import {
  type ExplicitWaggleCommandResult,
  publishExplicitWaggleResult,
} from './explicit-waggle-command-result'
import { executeWaggleRun } from './waggle-run-service'

export function runRegisteredExplicitWaggle(input: {
  readonly sessionId: SessionId
  readonly runId: string
  readonly payload: ReturnType<typeof toAgentSendPayload>
  readonly model: SupportedModelId
  readonly config: ReturnType<typeof toWaggleConfig>
  readonly abortController: AbortController
}) {
  return Effect.gen(function* () {
    const result: ExplicitWaggleCommandResult = yield* executeWaggleRun({
      sessionId: input.sessionId,
      runId: input.runId,
      payload: input.payload,
      model: input.model,
      config: input.config,
      signal: input.abortController.signal,
      onRunPrepared: (runtimeModel) => startWaggleStream(input, runtimeModel),
      onEvent: (event, meta) => {
        publishSessionHostEvent({
          kind: 'session-waggle-transport',
          sessionId: input.sessionId,
          event,
          meta,
        })
        if (event.type !== 'agent_end') {
          publishSessionHostEvent({
            kind: 'session-transport',
            sessionId: input.sessionId,
            event,
          })
        }
      },
      onTurnEvent: (event) =>
        publishSessionHostEvent({
          kind: 'session-waggle-turn',
          sessionId: input.sessionId,
          event,
        }),
      onWorktreeLaunch: (progress) => emitWorktreeLaunchProgress(input.sessionId, progress),
      onTitleAssigned: () =>
        publishSessionHostEvent({
          kind: 'session-list-changed',
          sessionId: input.sessionId,
          change: 'updated',
        }),
    })

    if (result.outcome === 'error') emitWorktreeLaunchFailure(input.sessionId, result.message)
    publishExplicitWaggleResult(input.sessionId, input.runId, result)
    return result
  })
}

function startWaggleStream(
  input: { readonly sessionId: SessionId; readonly runId: string },
  runtimeModel: SupportedModelId,
) {
  publishSessionHostEvent({
    kind: 'session-transport',
    sessionId: input.sessionId,
    event: {
      type: 'agent_start',
      timestamp: Date.now(),
      runId: input.runId,
      model: runtimeModel,
    },
  })
}
