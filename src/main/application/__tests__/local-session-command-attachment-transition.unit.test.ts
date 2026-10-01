import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { interruptExactSessionRun, reserveActiveSessionRun } from '../active-session-runs'
import { dispatchAdmittedSessionControlCommand } from '../local-session-command-dispatcher'
import { noUndeliveredSteers } from './agent-steering-test-layer'
import {
  controlPayload,
  localUser,
  settingsLayer,
} from './local-session-command-dispatcher.test-support'
import { unusedDispatcherCommandDependencies } from './local-session-command-dispatcher-dependencies.test-support'
import { makePromotionReplacementLayer } from './session-control-promotion-replacement.test-support'

function testLayer(state: Parameters<typeof makePromotionReplacementLayer>[0]) {
  const setup = makePromotionReplacementLayer(state)
  return {
    setup,
    layer: Layer.mergeAll(settingsLayer, unusedDispatcherCommandDependencies(), setup.layer),
  }
}

describe('Local Session attachment transition dispatch', () => {
  it('completes an accepted steer whose attachment release nests inside the dispatcher transition', async () => {
    const { layer, setup } = testLayer({
      sessionId: SessionId('session-worker'),
      revision: 7,
      run: { state: 'active', runId: RunId('run-active') },
      followUpQueue: { state: 'running', revision: 0, items: [] },
    })

    const result = await Effect.runPromise(
      dispatchAdmittedSessionControlCommand({
        caller: localUser,
        payload: controlPayload({
          operation: 'steer',
          sessionId: 'session-worker',
          expectedRunId: 'run-active',
          input: { text: 'Use the corrected order.', attachmentIds: ['attachment-steer'] },
        }),
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      contract: 'session-control-v2',
      response: { outcome: { effect: 'steered-run' } },
    })
    expect(setup.release).toHaveBeenCalledOnce()
  })

  it('completes an accepted promotion whose attachment release nests inside the dispatcher transition', async () => {
    const { layer, setup } = testLayer({
      sessionId: SessionId('session-worker'),
      revision: 5,
      run: { state: 'active', runId: RunId('run-active') },
      followUpQueue: {
        state: 'running',
        revision: 2,
        items: [
          {
            id: FollowUpId('follow-up-next'),
            deliveryState: 'pending',
            intent: {
              text: 'Promote this now.',
              attachmentIds: ['attachment-promote'],
              callerId: localUser.callerId,
              acceptedAt: 1_000,
              idempotencyKey: 'follow-up',
            },
          },
        ],
      },
    })

    const result = await Effect.runPromise(
      dispatchAdmittedSessionControlCommand({
        caller: localUser,
        payload: controlPayload({
          operation: 'promote',
          sessionId: 'session-worker',
          expectedRunId: 'run-active',
          followUpId: 'follow-up-next',
        }),
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      contract: 'session-control-v2',
      response: { outcome: { effect: 'promoted-follow-up' } },
    })
    expect(setup.release).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'interrupts compaction-blocked promotion before steering settles with accepted=%s',
    async (steeringAccepted) => {
      const sessionId = SessionId(`session-stop-compacting-promotion-${steeringAccepted}`)
      const runId = RunId('compacting-run')
      const run = reserveActiveSessionRun(sessionId, runId)
      const steeringEntered = Promise.withResolvers<void>()
      const finishSteering = Promise.withResolvers<void>()
      const setup = makePromotionReplacementLayer(
        {
          sessionId,
          revision: 5,
          run: { state: 'active', runId },
          followUpQueue: {
            state: 'running',
            revision: 2,
            items: [
              {
                id: FollowUpId('follow-up-next'),
                deliveryState: 'pending',
                intent: {
                  text: 'Promote this after compaction.',
                  attachmentIds: ['attachment-promote'],
                  callerId: localUser.callerId,
                  acceptedAt: 1_000,
                  idempotencyKey: 'follow-up',
                },
              },
            ],
          },
        },
        {
          interrupt: (input) =>
            Effect.promise(() =>
              interruptExactSessionRun(SessionId(input.sessionId), input.runId),
            ).pipe(
              Effect.map((accepted) =>
                accepted
                  ? { accepted: true as const }
                  : { accepted: false as const, code: 'run_not_live' as const },
              ),
            ),
        },
      )
      const layer = Layer.mergeAll(
        settingsLayer,
        unusedDispatcherCommandDependencies(),
        setup.layer,
        Layer.succeed(AgentSteeringService, {
          ...noUndeliveredSteers,
          steer: () =>
            Effect.promise(async () => {
              steeringEntered.resolve()
              await finishSteering.promise
              return steeringAccepted
                ? { accepted: true as const, receipt: { delivery: 'handled' as const } }
                : { accepted: false as const, code: 'run_not_live' as const }
            }),
        }),
      )
      const promote = Effect.runPromise(
        dispatchAdmittedSessionControlCommand({
          caller: localUser,
          payload: controlPayload({
            operation: 'promote',
            sessionId,
            expectedRunId: runId,
            followUpId: 'follow-up-next',
          }),
        }).pipe(Effect.provide(layer)),
      )
      try {
        await steeringEntered.promise
        const stop = Effect.runPromise(
          dispatchAdmittedSessionControlCommand({
            caller: localUser,
            payload: controlPayload({ operation: 'interrupt', sessionId, expectedRunId: runId }),
          }).pipe(Effect.provide(layer)),
        )
        await vi.waitFor(() => expect(run.controller.signal.aborted).toBe(true))
        expect(setup.state().run).toEqual({ state: 'stopping', runId })
        finishSteering.resolve()
        const promotion = await promote
        expect(promotion.response.outcome.effect).toBe(
          steeringAccepted ? 'promoted-follow-up' : 'rejected',
        )
        expect(setup.state().followUpQueue.items).toHaveLength(steeringAccepted ? 0 : 1)
        run.release()
        await expect(stop).resolves.toMatchObject({
          response: { outcome: { effect: 'interruption-requested', runId } },
        })

        const nextRun = reserveActiveSessionRun(sessionId, 'later-run')
        try {
          await expect(interruptExactSessionRun(sessionId, runId)).resolves.toBe(false)
          expect(nextRun.controller.signal.aborted).toBe(false)
        } finally {
          nextRun.release()
        }
      } finally {
        finishSteering.resolve()
        run.release()
        await promote
      }
    },
  )
})
