import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { UndeliveredSteer } from '../../domain/session-control/undelivered-steering'
import { SessionControlRepositoryError } from '../../errors'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import {
  SessionControlRunLifecycleRepository,
  type SessionControlRunLifecycleRepositoryShape,
  type SessionControlRunSettlementResult,
} from '../../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { installSessionHostEventPublisher } from '../../session-host/session-host-events'
import { coordinateSessionRuns } from '../session-control-run-coordinator'
import { settleExternalSessionRun } from '../session-external-run-coordinator'

type SettleInput = Parameters<SessionControlRunLifecycleRepositoryShape['settle']>[0]

const sessionId = SessionId('session-stopped')
const runId = RunId('run-stopped')
const undelivered: readonly UndeliveredSteer[] = [
  {
    delivery: { kind: 'promoted-follow-up', followUpId: FollowUpId('follow-up-steered') },
    handedOff: true,
  },
]

function harness(
  settle: (
    input: SettleInput,
  ) => Effect.Effect<SessionControlRunSettlementResult, SessionControlRepositoryError>,
) {
  const events: string[] = []
  const settleInputs: SettleInput[] = []
  const published: SessionHostEventPayload[] = []
  const retained = new Map<string, readonly UndeliveredSteer[]>([[runId, undelivered]])
  const layer = Layer.mergeAll(
    Layer.succeed(SessionControlIdentityService, {
      nextRunId: Effect.succeed(RunId('run-next')),
      nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
      nextReportId: Effect.succeed(ReportId('report-unused')),
      nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
      now: Effect.succeed(2000),
    }),
    Layer.succeed(SessionControlRunLifecycleRepository, {
      activate: () =>
        Effect.succeed({
          accepted: true as const,
          stateRevision: 1,
          intent: {
            text: 'Work.',
            attachmentIds: [],
            callerId: 'local-user',
            acceptedAt: 1000,
            idempotencyKey: 'start',
          },
        }),
      settle: (input) =>
        Effect.suspend(() => {
          events.push('settle')
          settleInputs.push(input)
          return settle(input)
        }),
      recoverHostLoss: Effect.succeed([]),
    }),
    Layer.succeed(SessionControlRunExecutor, {
      execute: () =>
        Effect.sync(() => {
          events.push('execute')
          return { terminalStatus: 'interrupted' as const }
        }),
    }),
    Layer.succeed(AgentSteeringService, {
      steer: () => Effect.die('No steering in this test.'),
      readUndelivered: (readRunId: string) =>
        Effect.sync(() => {
          events.push(`read:${readRunId}`)
          return retained.get(readRunId) ?? []
        }),
      forgetUndelivered: (forgottenRunId: string) =>
        Effect.sync(() => {
          events.push(`forget:${forgottenRunId}`)
          retained.delete(forgottenRunId)
        }),
    }),
    Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
      deliverPendingToActiveRun: () => Effect.succeed(false),
      deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
    }),
  )
  const run = <A, E>(
    effect: Effect.Effect<A, E, Layer.Layer.Success<typeof layer>>,
  ): Promise<A> => {
    const uninstall = installSessionHostEventPublisher((payload) => published.push(payload))
    return Effect.runPromise(effect.pipe(Effect.provide(layer))).finally(uninstall)
  }
  return { events, settleInputs, published, retained, run }
}

describe('Session Control Run coordinators and Undelivered steering messages', () => {
  it('settles a stopped Run with its steers and forgets them only after settlement', async () => {
    const setup = harness(() => Effect.succeed({ accepted: true, stateRevision: 4 }))

    await setup.run(coordinateSessionRuns({ sessionId, startingRunId: runId }))

    expect(setup.events).toEqual(['execute', `read:${runId}`, 'settle', `forget:${runId}`])
    expect(setup.settleInputs).toEqual([
      expect.objectContaining({
        runId,
        terminalStatus: 'interrupted',
        undeliveredSteers: undelivered,
      }),
    ])
  })

  it('keeps the steers for a retry when settlement fails', async () => {
    const setup = harness(() =>
      Effect.fail(new SessionControlRepositoryError({ operation: 'settle-run', cause: 'busy' })),
    )

    await expect(
      setup.run(coordinateSessionRuns({ sessionId, startingRunId: runId })),
    ).rejects.toThrow()

    expect(setup.events).not.toContain(`forget:${runId}`)
    expect(setup.retained.get(runId)).toEqual(undelivered)
  })

  it('publishes steers a displaced Run returned even though its settlement was rejected', async () => {
    const setup = harness(() =>
      Effect.succeed({ accepted: false, code: 'run_changed', stateRevision: 9 }),
    )

    await setup.run(coordinateSessionRuns({ sessionId, startingRunId: runId }))

    expect(setup.published).toContainEqual({
      kind: 'session-state-changed',
      sessionId,
      stateRevision: 9,
      operation: 'steers-returned',
      runId,
    })
    expect(setup.retained.has(runId)).toBe(false)
  })

  it('settles an external Waggle Run with its steers', async () => {
    const setup = harness(() => Effect.succeed({ accepted: true, stateRevision: 5 }))

    await setup.run(settleExternalSessionRun({ sessionId, runId, terminalStatus: 'interrupted' }))

    expect(setup.settleInputs).toEqual([
      expect.objectContaining({ runId, undeliveredSteers: undelivered }),
    ])
    expect(setup.events).toEqual([`read:${runId}`, 'settle', `forget:${runId}`])
  })

  it('names the external Run it settles when the Host goes on to a queued Follow-up', async () => {
    const setup = harness(() =>
      Effect.succeed(
        fromPartial<SessionControlRunSettlementResult>({
          accepted: true,
          stateRevision: 6,
          scheduled: { followUpId: FollowUpId('follow-up-1'), runId: RunId('run-2') },
        }),
      ),
    )

    await setup.run(settleExternalSessionRun({ sessionId, runId, terminalStatus: 'completed' }))

    // The renderer relays a hand-off only when it names the settled Run.
    expect(setup.published).toContainEqual({
      kind: 'session-state-changed',
      sessionId,
      stateRevision: 6,
      operation: 'follow-up-started',
      runId,
      terminalStatus: 'completed',
    })
  })
})
