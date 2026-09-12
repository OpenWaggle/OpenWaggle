import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { promoteSessionFollowUp } from '../session-control-promotion-service'
import { replaceSessionRun } from '../session-control-replacement-service'
import { makePromotionReplacementLayer } from './session-control-promotion-replacement.test-support'

describe('Session Control promotion and replacement', () => {
  it('delivers a promoted Follow-up as steering before removing it from the queue', async () => {
    const setup = makePromotionReplacementLayer({
      sessionId: SessionId('session-target'),
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
              text: 'Steer this now.',
              attachmentIds: [],
              visualizationContext: {
                title: 'Service map',
                sourcePath: '/repo/service-map.html',
                state: { selectedService: 'api' },
              },
              callerId: 'local-user',
              acceptedAt: 1000,
              idempotencyKey: 'follow-up',
            },
          },
        ],
      },
    })

    const response = await Effect.runPromise(
      promoteSessionFollowUp({
        callerId: 'local-user',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-promote',
          idempotencyKey: 'idempotency-promote',
          command: {
            operation: 'promote',
            sessionId: 'session-target',
            expectedRunId: 'run-active',
            followUpId: 'follow-up-next',
          },
        },
      }).pipe(Effect.provide(setup.layer)),
    )

    expect(setup.steer).toHaveBeenCalledWith({
      runId: RunId('run-active'),
      text: 'Steer this now.',
      attachments: [],
      visualizationContext: {
        title: 'Service map',
        sourcePath: '/repo/service-map.html',
        state: { selectedService: 'api' },
      },
    })
    expect(setup.state().followUpQueue.items).toEqual([])
    expect(response.outcome).toMatchObject({
      effect: 'promoted-follow-up',
      queueRevision: 3,
      stateRevision: 6,
    })
    expect(setup.release).toHaveBeenCalledOnce()
  })

  it('retains a promoted Follow-up attachment when steering fails', async () => {
    const setup = makePromotionReplacementLayer(
      {
        sessionId: SessionId('session-target'),
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
                text: 'Steer this now.',
                attachmentIds: ['attachment-retained'],
                callerId: 'local-user',
                acceptedAt: 1000,
                idempotencyKey: 'follow-up',
              },
            },
          ],
        },
      },
      { steeringAccepted: false },
    )

    const response = await Effect.runPromise(
      promoteSessionFollowUp({
        callerId: 'local-user',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-promote-failed',
          idempotencyKey: 'idempotency-promote-failed',
          command: {
            operation: 'promote',
            sessionId: 'session-target',
            expectedRunId: 'run-active',
            followUpId: 'follow-up-next',
          },
        },
      }).pipe(Effect.provide(setup.layer)),
    )

    expect(response.outcome).toMatchObject({ effect: 'rejected', code: 'run_not_live' })
    expect(setup.release).not.toHaveBeenCalled()
    expect(setup.state().followUpQueue.items).toHaveLength(1)
  })

  it('preserves the committed promotion when attachment cleanup fails', async () => {
    const setup = makePromotionReplacementLayer(
      {
        sessionId: SessionId('session-target'),
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
                text: 'Steer this now.',
                attachmentIds: ['attachment-cleanup-fails'],
                callerId: 'local-user',
                acceptedAt: 1000,
                idempotencyKey: 'follow-up',
              },
            },
          ],
        },
      },
      { release: () => Effect.fail(new Error('cleanup failed')) },
    )

    const result = await Effect.runPromise(
      promoteSessionFollowUp({
        callerId: 'local-user',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-promote-cleanup-fails',
          idempotencyKey: 'idempotency-promote-cleanup-fails',
          command: {
            operation: 'promote',
            sessionId: 'session-target',
            expectedRunId: 'run-active',
            followUpId: 'follow-up-next',
          },
        },
      }).pipe(Effect.provide(setup.layer)),
    )

    expect(result.outcome).toMatchObject({ effect: 'promoted-follow-up' })
    expect(setup.state().followUpQueue.items).toEqual([])
  })

  it('interrupts the exact Run before installing its replacement intent', async () => {
    let finishInterruption: () => void = () => undefined
    const interruptionFinished = new Promise<void>((resolve) => {
      finishInterruption = resolve
    })
    const setup = makePromotionReplacementLayer(
      {
        sessionId: SessionId('session-target'),
        revision: 7,
        run: { state: 'active', runId: RunId('run-active') },
        followUpQueue: { state: 'running', revision: 0, items: [] },
      },
      {
        interrupt: () =>
          Effect.promise(async () => {
            await interruptionFinished
            return { accepted: true } as const
          }),
      },
    )

    let replacementSettled = false
    const replacement = Effect.runPromise(
      replaceSessionRun({
        callerId: 'local-user',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-replace',
          idempotencyKey: 'idempotency-replace',
          command: {
            operation: 'replace',
            sessionId: 'session-target',
            expectedRunId: 'run-active',
            runAuthorizationOverride: 'yolo',
            input: { text: 'Use the replacement.', attachmentIds: [] },
          },
        },
      }).pipe(Effect.provide(setup.layer)),
    ).then((response) => {
      replacementSettled = true
      return response
    })

    await vi.waitFor(() =>
      expect(setup.interrupt).toHaveBeenCalledWith({
        sessionId: 'session-target',
        runId: RunId('run-active'),
      }),
    )
    expect(replacementSettled).toBe(false)
    expect(setup.state().run).toEqual({ state: 'stopping', runId: RunId('run-active') })

    finishInterruption()
    const response = await replacement
    expect(setup.state()).toMatchObject({
      revision: 9,
      run: {
        state: 'starting',
        runId: RunId('run-replacement'),
        intent: { text: 'Use the replacement.', runAuthorizationOverride: 'yolo' },
      },
    })
    expect(response.outcome).toMatchObject({
      effect: 'replaced-run',
      interruptedRunId: RunId('run-active'),
      runId: RunId('run-replacement'),
      stateRevision: 9,
    })
  })
})
