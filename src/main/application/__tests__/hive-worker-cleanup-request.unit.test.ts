import { SessionId } from '@shared/types/brand'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlDelegationMutationRequest,
  type SessionControlMutationRequest,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { HiveWorkerCleanup } from '../../ports/hive-worker-cleanup'
import {
  restoreHiveWorkerAfterCommand,
  restoreHiveWorkerAfterDelegationReview,
} from '../hive-worker-cleanup-request'

const AGENT = 'session-agent:queen:run-queen'
const USER = 'gui:local-user'

function envelope<C>(command: C) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: 'request',
    idempotencyKey: 'key',
    command,
  }
}

function responseWith(
  outcome: Partial<SessionControlMutationResponse['outcome']>,
  replayed = false,
): SessionControlMutationResponse {
  return fromPartial({ ...envelope(undefined), replayed, outcome })
}

function capture<A, E>(effect: Effect.Effect<A, E, HiveWorkerCleanup>) {
  const restored: { callerId: string; sessionId: SessionId; idempotencyKey: string }[] = []
  return Effect.runPromise(
    effect.pipe(
      Effect.provideService(HiveWorkerCleanup, {
        requestReconciliation: () => Effect.void,
        restoreForCommand: (input) => Effect.sync(() => void restored.push(input)),
      }),
      Effect.as(restored),
    ),
  )
}

const conversation = (operation: 'message' | 'start' | 'follow-up' | 'replace' | 'steer') =>
  fromPartial<SessionControlMutationRequest['command']>({ operation, sessionId: 'worker' })

describe('restoreHiveWorkerAfterCommand', () => {
  it.each([
    ...(['message', 'start', 'follow-up', 'replace', 'steer'] as const).flatMap((operation) => [
      [operation, AGENT] as const,
      [operation, USER] as const,
    ]),
  ])('restores the addressed Session after an accepted %s from %s', async (operation, callerId) => {
    const restored = await capture(
      restoreHiveWorkerAfterCommand({
        callerId,
        request: envelope(conversation(operation)),
        response: responseWith({ effect: 'started-run' }),
      }),
    )

    expect(restored).toEqual([{ callerId, sessionId: SessionId('worker'), idempotencyKey: 'key' }])
  })

  it('does nothing for a rejected or replayed command, or one that does not resume work', async () => {
    const restored = await capture(
      Effect.all([
        restoreHiveWorkerAfterCommand({
          callerId: AGENT,
          request: envelope(conversation('start')),
          response: responseWith({ effect: 'rejected' }),
        }),
        restoreHiveWorkerAfterCommand({
          callerId: AGENT,
          request: envelope(conversation('follow-up')),
          response: responseWith({ effect: 'queued-follow-up' }, true),
        }),
        restoreHiveWorkerAfterCommand({
          callerId: AGENT,
          request: envelope(
            fromPartial<SessionControlMutationRequest['command']>({
              operation: 'interrupt',
              sessionId: 'worker',
            }),
          ),
          response: responseWith({ effect: 'interruption-requested' }),
        }),
      ]),
    )

    expect(restored).toEqual([])
  })
})

describe('restoreHiveWorkerAfterDelegationReview', () => {
  const review = (
    operation: SessionControlDelegationMutationRequest['command']['operation'],
  ): SessionControlDelegationMutationRequest =>
    envelope(fromPartial({ operation, sessionId: 'queen', delegationId: 'delegation-worker' }))

  it.each([
    ['delegation-reopen', AGENT],
    ['delegation-request-revision', AGENT],
    ['delegation-reopen', USER],
  ] as const)(
    'restores the Worker a %s from %s sends back to work',
    async (operation, callerId) => {
      const restored = await capture(
        restoreHiveWorkerAfterDelegationReview({
          callerId,
          request: review(operation),
          response: responseWith({
            effect: 'delegation-updated',
            workerSessionId: 'worker',
            delegationState: 'revision_requested',
          }),
        }),
      )

      expect(restored).toEqual([
        { callerId, sessionId: SessionId('worker'), idempotencyKey: 'key' },
      ])
    },
  )

  it('does nothing for an accept, a rejected or replayed review, or another state', async () => {
    const reopened = {
      effect: 'delegation-updated',
      workerSessionId: 'worker',
      delegationState: 'revision_requested',
    } as const
    const restored = await capture(
      Effect.all([
        restoreHiveWorkerAfterDelegationReview({
          callerId: AGENT,
          request: review('delegation-accept'),
          response: responseWith({ ...reopened, delegationState: 'accepted' }),
        }),
        restoreHiveWorkerAfterDelegationReview({
          callerId: AGENT,
          request: review('delegation-reopen'),
          response: responseWith({ effect: 'rejected' }),
        }),
        restoreHiveWorkerAfterDelegationReview({
          callerId: AGENT,
          request: review('delegation-reopen'),
          response: responseWith(reopened, true),
        }),
        restoreHiveWorkerAfterDelegationReview({
          callerId: AGENT,
          request: review('delegation-state'),
          response: responseWith(reopened),
        }),
      ]),
    )

    expect(restored).toEqual([])
  })
})
