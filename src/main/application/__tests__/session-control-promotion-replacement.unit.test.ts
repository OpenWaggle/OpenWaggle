import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import type { SessionControlSessionState } from '../../domain/session-control/message-aggregate'
import {
  type AgentRunInterruptionInput,
  type AgentRunInterruptionResult,
  AgentRunInterruptionService,
} from '../../ports/agent-run-interruption-service'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { promoteSessionFollowUp } from '../session-control-promotion-service'
import { replaceSessionRun } from '../session-control-replacement-service'

function makeLayer(
  initialState: SessionControlSessionState,
  options?: {
    readonly interrupt?: (
      input: AgentRunInterruptionInput,
    ) => Effect.Effect<AgentRunInterruptionResult>
    readonly steeringAccepted?: boolean
  },
) {
  let state = initialState
  const steer = vi.fn((_input: unknown) =>
    options?.steeringAccepted === false
      ? { accepted: false as const, code: 'run_not_live' as const }
      : { accepted: true as const },
  )
  const interrupt = vi.fn((_input: unknown) => ({ accepted: true as const }))
  const release = vi.fn(() => Effect.void)
  return {
    steer,
    interrupt,
    release,
    state: () => state,
    layer: Layer.mergeAll(
      Layer.succeed(SessionControlOperationJournal, {
        claim: (input) =>
          Effect.sync(() => {
            const decision = input.decide(state)
            if (!decision.accepted) {
              return { status: 'completed', replayed: false, outcome: decision.outcome } as const
            }
            if (decision.state) state = decision.state
            return { status: 'claimed', stateRevision: state.revision } as const
          }),
        complete: (input) =>
          Effect.sync(() => {
            if (input.finalizeState) state = input.finalizeState(state)
          }),
      }),
      Layer.succeed(SessionControlAttachmentService, {
        prepare: () => Effect.succeed([]),
        bind: () => Effect.void,
        cleanupUnreferenced: () => Effect.void,
        resolve: () => Effect.succeed([]),
        release,
      }),
      Layer.succeed(AgentSteeringService, {
        steer: (input) => Effect.succeed(steer(input)),
      }),
      Layer.succeed(AgentRunInterruptionService, {
        interrupt: (input) => {
          const outcome = interrupt(input)
          return options?.interrupt?.(input) ?? Effect.succeed(outcome)
        },
      }),
      Layer.succeed(SessionControlIdentityService, {
        nextRunId: Effect.succeed(RunId('run-replacement')),
        nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
        nextReportId: Effect.succeed(ReportId('report-unused')),
        nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
        now: Effect.succeed(2000),
      }),
    ),
  }
}

describe('Session Control promotion and replacement', () => {
  it('delivers a promoted Follow-up as steering before removing it from the queue', async () => {
    const setup = makeLayer({
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
    const setup = makeLayer(
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

  it('interrupts the exact Run before installing its replacement intent', async () => {
    let finishInterruption: () => void = () => undefined
    const interruptionFinished = new Promise<void>((resolve) => {
      finishInterruption = resolve
    })
    const setup = makeLayer(
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
