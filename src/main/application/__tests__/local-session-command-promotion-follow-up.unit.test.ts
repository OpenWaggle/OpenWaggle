import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { SessionControlRepository } from '../../ports/session-control-repository'
import { dispatchAdmittedSessionControlCommand } from '../local-session-command-dispatcher'
import { noUndeliveredSteers } from './agent-steering-test-layer'
import {
  controlPayload,
  localUser,
  settingsLayer,
} from './local-session-command-dispatcher.test-support'
import { unusedDispatcherCommandDependencies } from './local-session-command-dispatcher-dependencies.test-support'
import { makePromotionReplacementLayer } from './session-control-promotion-replacement.test-support'

/** The dispatcher runs uninterruptibly, so an Effect timeout would wait for it: race instead. */
function within<A>(promise: Promise<A>, message: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), 1_000)),
  ])
}

describe('Session commands during a pending promotion', () => {
  it('queues a Follow-up while a promotion waits for Pi to incorporate its steer', async () => {
    // Steering a queued message promotes it with durable delivery, which resolves only at Pi's
    // next turn boundary. The promotion stepped aside from the attachment transition but kept the
    // Session's command serialization, so a Follow-up queued meanwhile took the transition and
    // waited on the serialization, and the delivered promotion then waited on the transition
    // forever: neither the Follow-up nor the promotion ever completed.
    const sessionId = SessionId('session-follow-up-during-promotion')
    const steeringEntered = Promise.withResolvers<void>()
    const delivered = Promise.withResolvers<void>()
    const setup = makePromotionReplacementLayer({
      sessionId,
      revision: 5,
      run: { state: 'active', runId: RunId('run-active') },
      followUpQueue: {
        state: 'running',
        revision: 2,
        items: [
          {
            id: FollowUpId('follow-up-steered'),
            deliveryState: 'pending',
            intent: {
              text: 'Steer this into the Run.',
              attachmentIds: [],
              callerId: localUser.callerId,
              acceptedAt: 1_000,
              idempotencyKey: 'follow-up-steered',
            },
          },
        ],
      },
    })
    const layer = Layer.mergeAll(
      settingsLayer,
      unusedDispatcherCommandDependencies(),
      setup.layer,
      Layer.succeed(SessionControlRepository, {
        executeMutation: (input) =>
          Effect.sync(() => {
            const decision = input.decide(setup.state())
            if (decision.accepted) setup.updateState(() => decision.state)
            return { replayed: false, outcome: decision.outcome }
          }),
      }),
      Layer.succeed(AgentSteeringService, {
        ...noUndeliveredSteers,
        steer: () =>
          Effect.promise(async () => {
            steeringEntered.resolve()
            await delivered.promise
            return { accepted: true as const, receipt: { delivery: 'handled' as const } }
          }),
      }),
    )
    const promote = Effect.runPromise(
      dispatchAdmittedSessionControlCommand({
        caller: localUser,
        payload: controlPayload({
          operation: 'promote',
          sessionId,
          expectedRunId: 'run-active',
          followUpId: 'follow-up-steered',
        }),
      }).pipe(Effect.provide(layer)),
    )
    try {
      await steeringEntered.promise
      const followUp = await within(
        Effect.runPromise(
          dispatchAdmittedSessionControlCommand({
            caller: localUser,
            payload: controlPayload({
              operation: 'follow-up',
              sessionId,
              input: { text: 'And then do this.', attachmentIds: [] },
            }),
          }).pipe(Effect.provide(layer)),
        ),
        'The Follow-up waited behind the promotion.',
      )
      expect(followUp.response.outcome.effect).toBe('queued-follow-up')
    } finally {
      delivered.resolve()
    }

    await expect(
      within(promote, 'The delivered promotion never completed.'),
    ).resolves.toMatchObject({ response: { outcome: { effect: 'promoted-follow-up' } } })
    expect(setup.state().followUpQueue.items.map((item) => item.intent.text)).toEqual([
      'And then do this.',
    ])
  })
})
