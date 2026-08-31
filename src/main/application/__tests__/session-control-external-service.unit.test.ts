import { RunId, SessionId } from '@shared/types/brand'
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
import {
  type AgentSteeringInput,
  type AgentSteeringResult,
  AgentSteeringService,
} from '../../ports/agent-steering-service'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { interruptSessionRun, steerSessionRun } from '../session-control-external-service'

const request = {
  contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
  requestId: 'request-steer',
  idempotencyKey: 'idempotency-steer',
  command: {
    operation: 'steer',
    sessionId: 'session-target',
    expectedRunId: 'run-active',
    input: { text: 'Use the corrected migration order.', attachmentIds: [] },
  },
} as const

function makeLayer(input: {
  readonly state: SessionControlSessionState
  readonly steer: (input: AgentSteeringInput) => Promise<AgentSteeringResult>
  readonly interrupt?: (input: AgentRunInterruptionInput) => AgentRunInterruptionResult
}) {
  let completedOutcome: unknown
  let currentState = input.state
  const release = vi.fn(() => Effect.void)
  return {
    release,
    layer: Layer.mergeAll(
      Layer.succeed(SessionControlOperationJournal, {
        claim: (claimInput) =>
          Effect.sync(() => {
            const decision = claimInput.decide(currentState)
            if (decision.accepted && decision.state) currentState = decision.state
            return decision.accepted
              ? ({ status: 'claimed', stateRevision: currentState.revision } as const)
              : ({ status: 'completed', replayed: false, outcome: decision.outcome } as const)
          }),
        complete: (completeInput) =>
          Effect.sync(() => {
            completedOutcome = completeInput.outcome
            if (completeInput.finalizeState) {
              currentState = completeInput.finalizeState(currentState)
            }
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
        steer: (steeringInput) => Effect.promise(() => input.steer(steeringInput)),
      }),
      Layer.succeed(AgentRunInterruptionService, {
        interrupt: (interruptionInput) =>
          Effect.succeed(input.interrupt?.(interruptionInput) ?? ({ accepted: true } as const)),
      }),
    ),
    completedOutcome: () => completedOutcome,
    state: () => currentState,
  }
}

describe('Session Control external command service', () => {
  it('claims and completes an exact-Run Pi steering side effect', async () => {
    const steer = vi.fn(async () => ({ accepted: true as const }))
    const setup = makeLayer({
      state: {
        sessionId: SessionId('session-target'),
        revision: 7,
        run: { state: 'active', runId: RunId('run-active') },
        followUpQueue: { state: 'running', revision: 0, items: [] },
      },
      steer,
    })

    const response = await Effect.runPromise(
      steerSessionRun({ callerId: 'local-user', request }).pipe(Effect.provide(setup.layer)),
    )

    expect(steer).toHaveBeenCalledOnce()
    expect(steer).toHaveBeenCalledWith({
      runId: 'run-active',
      text: 'Use the corrected migration order.',
      attachments: [],
    })
    expect(response).toEqual({
      contractVersion: 2,
      requestId: 'request-steer',
      idempotencyKey: 'idempotency-steer',
      replayed: false,
      outcome: {
        operation: 'steer',
        effect: 'steered-run',
        sessionId: 'session-target',
        runId: 'run-active',
        stateRevision: 7,
      },
    })
    expect(setup.completedOutcome()).toEqual(response.outcome)
    expect(setup.release).toHaveBeenCalledWith({
      attachmentIds: [],
      sessionId: 'session-target',
      ownerCallerId: 'local-user',
    })
  })

  it('rejects a stale expected Run before calling Pi', async () => {
    const steer = vi.fn(async () => ({ accepted: true as const }))
    const setup = makeLayer({
      state: {
        sessionId: SessionId('session-target'),
        revision: 8,
        run: { state: 'active', runId: RunId('run-new') },
        followUpQueue: { state: 'running', revision: 0, items: [] },
      },
      steer,
    })

    const response = await Effect.runPromise(
      steerSessionRun({ callerId: 'local-user', request }).pipe(Effect.provide(setup.layer)),
    )

    expect(steer).not.toHaveBeenCalled()
    expect(response.outcome).toEqual({
      operation: 'steer',
      effect: 'rejected',
      sessionId: SessionId('session-target'),
      code: 'run_changed',
    })
  })

  it('moves the exact Run to stopping before dispatching interruption', async () => {
    const interrupt = vi.fn((_input: AgentRunInterruptionInput) => ({ accepted: true as const }))
    const setup = makeLayer({
      state: {
        sessionId: SessionId('session-target'),
        revision: 9,
        run: { state: 'active', runId: RunId('run-active') },
        followUpQueue: { state: 'running', revision: 0, items: [] },
      },
      steer: vi.fn(async () => ({ accepted: true as const })),
      interrupt,
    })

    const response = await Effect.runPromise(
      interruptSessionRun({
        callerId: 'local-user',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-interrupt',
          idempotencyKey: 'idempotency-interrupt',
          command: {
            operation: 'interrupt',
            sessionId: 'session-target',
            expectedRunId: 'run-active',
          },
        },
      }).pipe(Effect.provide(setup.layer)),
    )

    expect(interrupt).toHaveBeenCalledWith({
      sessionId: 'session-target',
      runId: 'run-active',
    })
    expect(setup.state().run).toEqual({ state: 'stopping', runId: RunId('run-active') })
    expect(response.outcome).toEqual({
      operation: 'interrupt',
      effect: 'interruption-requested',
      sessionId: 'session-target',
      runId: 'run-active',
      stateRevision: 10,
    })
  })

  it('releases a claimed stopping state when the exact Run is no longer live', async () => {
    const setup = makeLayer({
      state: {
        sessionId: SessionId('session-target'),
        revision: 4,
        run: { state: 'active', runId: RunId('run-active') },
        followUpQueue: { state: 'running', revision: 0, items: [] },
      },
      steer: vi.fn(async () => ({ accepted: true as const })),
      interrupt: () => ({ accepted: false, code: 'run_not_live' }),
    })

    const response = await Effect.runPromise(
      interruptSessionRun({
        callerId: 'local-user',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-interrupt',
          idempotencyKey: 'idempotency-interrupt',
          command: {
            operation: 'interrupt',
            sessionId: 'session-target',
            expectedRunId: 'run-active',
          },
        },
      }).pipe(Effect.provide(setup.layer)),
    )

    expect(response.outcome).toMatchObject({ effect: 'rejected', code: 'run_not_live' })
    expect(setup.state()).toMatchObject({ revision: 6, run: { state: 'idle' } })
  })
})
