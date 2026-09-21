import { SessionId } from '@shared/types/brand'
import type {
  SessionControlMutationOutcome,
  SessionInteractionResponseMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import {
  clearAgentLoopInteractionBrokerForTests,
  requestAgentLoopInteraction,
} from '../agent-loop-interaction-broker'
import { respondToSessionInteraction } from '../session-interaction-service'

const sessionId = SessionId('session-interaction')

function request(
  operation: 'request-respond' | 'approval-respond',
): SessionInteractionResponseMutationRequest {
  return {
    contractVersion: 2,
    requestId: 'request-1',
    idempotencyKey: 'idempotency-1',
    command: {
      operation,
      sessionId,
      runId: 'run-1',
      interactionId: 'confirm-1',
      kind: 'confirm',
      response: { kind: 'confirm', accepted: true },
    },
  }
}

describe('Session interaction service', () => {
  beforeEach(() => {
    clearAgentLoopInteractionBrokerForTests()
  })

  it('resolves a parked interaction and journals the result', async () => {
    const completed: SessionControlMutationOutcome[] = []
    const layer = Layer.succeed(SessionControlOperationJournal, {
      claim: () => Effect.succeed({ status: 'claimed', stateRevision: 3 }),
      complete: (input) =>
        Effect.sync(() => {
          completed.push(input.outcome)
        }),
    })
    const pending = requestAgentLoopInteraction({
      interaction: {
        interactionId: 'confirm-1',
        sessionId,
        runId: 'run-1',
        kind: 'confirm',
        source: 'pi-ui',
        createdAt: 1,
        title: 'Continue?',
        message: 'Continue?',
        purpose: 'user-input',
      },
      onEvent: () => undefined,
    })

    const result = await Effect.runPromise(
      respondToSessionInteraction({
        callerId: 'local-user:machine',
        request: request('request-respond'),
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      replayed: false,
      outcome: { effect: 'interaction-resolved', interactionId: 'confirm-1' },
    })
    expect(completed).toEqual([result.outcome])
    await expect(pending).resolves.toEqual({ kind: 'confirm', accepted: true })
  })

  it('returns a completed response without answering the broker twice', async () => {
    const completed = vi.fn()
    const replayedOutcome: SessionControlMutationOutcome = {
      operation: 'approval-respond',
      effect: 'interaction-resolved',
      sessionId,
      runId: 'run-1',
      interactionId: 'confirm-1',
      status: 'resolved',
    }
    const layer = Layer.succeed(SessionControlOperationJournal, {
      claim: () =>
        Effect.succeed({ status: 'completed', replayed: true, outcome: replayedOutcome }),
      complete: () => Effect.sync(completed),
    })

    const result = await Effect.runPromise(
      respondToSessionInteraction({
        callerId: 'profile:reviewer',
        request: request('approval-respond'),
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({ replayed: true, outcome: replayedOutcome })
    expect(completed).not.toHaveBeenCalled()
  })
})
