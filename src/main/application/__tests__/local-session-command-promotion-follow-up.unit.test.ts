import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { SessionControlRepository } from '../../ports/session-control-repository'
import { dispatchAdmittedSessionControlCommand } from '../local-session-command-dispatcher'
import { withSessionAttachmentTransition } from '../session-attachment-cleanup'
import { withSessionCommandSerialization } from '../session-command-serialization'
import { noUndeliveredSteers } from './agent-steering-test-layer'
import {
  controlPayload,
  localUser,
  settingsLayer,
} from './local-session-command-dispatcher.test-support'
import { unusedDispatcherCommandDependencies } from './local-session-command-dispatcher-dependencies.test-support'
import { makePromotionReplacementLayer } from './session-control-promotion-replacement.test-support'
import { settlesWithin } from './settles-within.test-support'

/** A Session whose queued message is being promoted; its steer waits until `delivered`. */
function pendingPromotion(sessionId: SessionId) {
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
  const dispatch = (command: Parameters<typeof controlPayload>[0]) =>
    Effect.runPromise(
      dispatchAdmittedSessionControlCommand({
        caller: localUser,
        payload: controlPayload(command),
      }).pipe(Effect.provide(layer)),
    )
  const promote = dispatch({
    operation: 'promote',
    sessionId,
    expectedRunId: 'run-active',
    followUpId: 'follow-up-steered',
  })
  const followUp = () =>
    dispatch({
      operation: 'follow-up',
      sessionId,
      input: { text: 'And then do this.', attachmentIds: [] },
    })
  return { setup, steeringEntered, delivered, promote, followUp }
}

/**
 * Resolves once something holds the Session's attachment transition: a probe for it no longer
 * completes at once. Each probe left waiting runs harmlessly when the holder releases it. Gives up
 * (and stops probing) after about half a second.
 */
async function transitionTakenBack(sessionId: SessionId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let probed = false
    void Effect.runPromise(
      withSessionAttachmentTransition({
        sessionId,
        effect: Effect.sync(() => {
          probed = true
        }),
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (!probed) return
  }
  throw new Error('Nothing took the attachment transition.')
}

describe('Session commands during a pending promotion', () => {
  it('queues a Follow-up while a promotion waits for Pi to incorporate its steer', async () => {
    // Steering a queued message promotes it with durable delivery, which resolves only at Pi's
    // next turn boundary. The promotion stepped aside from the attachment transition but kept the
    // Session's command serialization, so a Follow-up queued meanwhile took the transition and
    // waited on the serialization, and the delivered promotion then waited on the transition
    // forever: neither the Follow-up nor the promotion ever completed.
    const { setup, steeringEntered, delivered, promote, followUp } = pendingPromotion(
      SessionId('session-follow-up-during-promotion'),
    )
    try {
      await steeringEntered.promise
      const queued = await settlesWithin(followUp(), 'The Follow-up waited behind the promotion.')
      expect(queued.response.outcome.effect).toBe('queued-follow-up')
    } finally {
      delivered.resolve()
    }

    await expect(
      settlesWithin(promote, 'The delivered promotion never completed.'),
    ).resolves.toMatchObject({
      response: {
        // The Follow-up queued meanwhile bumped both revisions: the promotion reports the
        // revisions its own change reached, not the claim's plus one.
        outcome: {
          effect: 'promoted-follow-up',
          queueRevision: 4,
          stateRevision: 7,
        },
      },
    })
    expect(setup.state()).toMatchObject({ revision: 7, followUpQueue: { revision: 4 } })
    expect(setup.state().followUpQueue.items.map((item) => item.intent.text)).toEqual([
      'And then do this.',
    ])
  })

  it('takes its locks back in the dispatcher order when a Follow-up arrives as it completes', async () => {
    // The delivered promotion must take the attachment transition back before the serialization.
    // Here it is delivered while another command holds the serialization, so it is still taking
    // its locks back when a Follow-up takes the transition and waits on the serialization. Taking
    // the serialization first would leave each holding what the other needs.
    const sessionId = SessionId('session-promotion-lock-order')
    const { steeringEntered, delivered, promote, followUp } = pendingPromotion(sessionId)
    const serialized = Promise.withResolvers<void>()
    const finishSerialized = Promise.withResolvers<void>()
    try {
      await steeringEntered.promise
      const other = Effect.runPromise(
        withSessionCommandSerialization(
          sessionId,
          Effect.promise(async () => {
            serialized.resolve()
            await finishSerialized.promise
          }),
        ),
      )
      await serialized.promise
      delivered.resolve()
      await expect(
        transitionTakenBack(sessionId),
        'The delivered promotion did not take the attachment transition back first.',
      ).resolves.toBeUndefined()
      const queued = followUp()
      // The Follow-up takes the transition only after the promotion releases it, so it is still
      // waiting on it here; were it holding it, it would wait on the serialization as before.
      await new Promise((resolve) => setTimeout(resolve, 20))
      finishSerialized.resolve()
      await other
      await expect(
        settlesWithin(
          Promise.all([promote, queued]),
          'The promotion and the Follow-up deadlocked.',
        ),
      ).resolves.toMatchObject([
        { response: { outcome: { effect: 'promoted-follow-up' } } },
        { response: { outcome: { effect: 'queued-follow-up' } } },
      ])
    } finally {
      delivered.resolve()
      finishSerialized.resolve()
    }
  })
})
