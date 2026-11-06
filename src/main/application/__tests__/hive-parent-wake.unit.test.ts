import { FollowUpId, ReportCorrelationId, ReportId, RunId, SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  SessionControlRunIntent,
  SessionControlSessionState,
} from '../../domain/session-control/message-aggregate'
import {
  activateStartingRun,
  settleAndScheduleNextFollowUp,
} from '../../domain/session-control/run-lifecycle'
import { SessionControlIdentityService } from '../../ports/session-control-identity-service'
import { SessionControlRepository } from '../../ports/session-control-repository'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import {
  type HiveParentWakeCandidate,
  SessionOrchestrationUpdateRepository,
} from '../../ports/session-orchestration-update-repository'
import { SettingsService } from '../../services/settings-service'
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import { activeRuns } from '../active-session-runs'
import { HIVE_WAKE_RUN_TEXT, wakeIdleParent } from '../hive-parent-wake'
import {
  type HiveParentWakeRequest,
  installHiveParentWakeHandler,
  notifyParentOfOrchestrationUpdates,
} from '../hive-parent-wake-request'
import { SessionHostEventHub } from '../session-host-event-hub'
import { SessionHostLiveness } from '../session-host-liveness'
import { unusedCommandDependencies } from './session-control-command-test-layer'

const QUEEN = SessionId('session-queen')

function harness(input: {
  readonly candidate: HiveParentWakeCandidate | undefined
  readonly rejectWith?: string
}) {
  let state: SessionControlSessionState = {
    sessionId: QUEEN,
    revision: 1,
    run: { state: 'idle' },
    followUpQueue: { state: 'running', revision: 0, items: [] },
  }
  const executed: SessionControlRunIntent[] = []
  const mutations: string[] = []
  const ran = Promise.withResolvers<void>()
  const runIds = [RunId('run-wake'), RunId('run-after-wake')]
  const layer = Layer.mergeAll(
    unusedCommandDependencies(),
    Layer.succeed(SessionControlRepository, {
      executeMutation: (mutation) =>
        Effect.sync(() => {
          mutations.push(`${mutation.callerId}:${mutation.request.command.operation}`)
          if (input.rejectWith) {
            return {
              replayed: false,
              outcome: {
                operation: 'start' as const,
                effect: 'rejected' as const,
                sessionId: QUEEN,
                code: input.rejectWith,
              },
            }
          }
          const decision = mutation.decide(state)
          if (decision.accepted) state = decision.state
          return { replayed: false, outcome: decision.outcome }
        }),
    }),
    Layer.succeed(SessionControlIdentityService, {
      nextRunId: Effect.sync(() => {
        const runId = runIds.shift()
        if (!runId) throw new Error('No Run identity available.')
        return runId
      }),
      nextFollowUpId: Effect.succeed(FollowUpId('follow-up-unused')),
      nextReportId: Effect.succeed(ReportId('report-unused')),
      nextReportCorrelationId: Effect.succeed(ReportCorrelationId('correlation-unused')),
      now: Effect.succeed(5_000),
    }),
    Layer.succeed(SessionControlRunLifecycleRepository, {
      activate: ({ runId }) =>
        Effect.sync(() => {
          const result = activateStartingRun(state, runId)
          if (!result.accepted) return result
          if (state.run.state !== 'starting') throw new Error('Missing starting Run intent.')
          const intent = state.run.intent
          state = result.state
          return { accepted: true, stateRevision: state.revision, intent }
        }),
      settle: ({ runId, nextRunId }) =>
        Effect.sync(() => {
          const result = settleAndScheduleNextFollowUp(state, runId, nextRunId)
          if (!result.accepted) return result
          state = result.state
          return { accepted: true, stateRevision: state.revision }
        }),
      recoverHostLoss: Effect.succeed([]),
    }),
    Layer.succeed(SessionControlRunExecutor, {
      execute: ({ intent }) =>
        Effect.sync(() => {
          executed.push(intent)
          ran.resolve()
          return { terminalStatus: 'completed' as const, terminalEventAt: 6_000 }
        }),
    }),
    Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
      deliverPendingToActiveRun: () => Effect.succeed(false),
      deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
    }),
    Layer.succeed(
      SessionOrchestrationUpdateRepository,
      fromPartial({ parentWakeCandidate: () => Effect.succeed(input.candidate) }),
    ),
    Layer.succeed(SettingsService, fromPartial({ get: () => Effect.succeed(DEFAULT_SETTINGS) })),
  )
  return { layer, executed, mutations, ran: ran.promise }
}

const allowed = () => Effect.succeed({})

describe('Hive wake of an idle parent', () => {
  const releases: (() => void)[] = []

  afterEach(() => {
    for (const release of releases.splice(0)) release()
    for (const sessionId of activeRuns.keys()) activeRuns.delete(sessionId)
  })

  function installRuntime() {
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    releases.push(installSessionHostEventRuntime({ eventHub: new SessionHostEventHub(), liveness }))
  }

  function captureWakeRequests() {
    const requests: HiveParentWakeRequest[] = []
    releases.push(installHiveParentWakeHandler((request) => requests.push(request)))
    return requests
  }

  it('starts a Host-authored Run as the caller of the parent’s latest Run', async () => {
    installRuntime()
    const requests = captureWakeRequests()
    const { layer, executed, mutations, ran } = harness({
      candidate: {
        parentSessionId: QUEEN,
        latestRunId: 'run-parent',
        callerId: 'local-user',
        piSessionFile: null,
      },
    })

    const outcome = await Effect.runPromise(
      wakeIdleParent({ parentSessionId: QUEEN }, allowed).pipe(Effect.provide(layer)),
    )
    await ran
    await vi.waitFor(() => expect(requests).toHaveLength(1))

    expect(outcome).toBe('started')
    expect(mutations).toEqual(['local-user:start'])
    expect(executed).toEqual([
      expect.objectContaining({
        text: HIVE_WAKE_RUN_TEXT,
        callerId: 'local-user',
        hiveWake: true,
      }),
    ])
    // The wake Run settled like any parent Run, so the Host checks again for updates it missed.
    expect(requests).toEqual([{ parentSessionId: QUEEN }])
  })

  it('runs no higher than the latest Run’s caller may, and not at all once it may not', async () => {
    installRuntime()
    const candidate = {
      parentSessionId: QUEEN,
      latestRunId: 'run-parent',
      callerId: 'profile:cli',
      piSessionFile: null,
    }
    const clamped = harness({ candidate })
    const outcome = await Effect.runPromise(
      wakeIdleParent({ parentSessionId: QUEEN }, () =>
        Effect.succeed({ runAuthorizationOverride: 'ask-for-approval' as const }),
      ).pipe(Effect.provide(clamped.layer)),
    )
    await clamped.ran
    const revoked = harness({ candidate })
    const refused = await Effect.runPromise(
      wakeIdleParent({ parentSessionId: QUEEN }, () =>
        Effect.succeed({ blocked: 'profile_revoked' }),
      ).pipe(Effect.provide(revoked.layer)),
    )

    expect(outcome).toBe('started')
    expect(clamped.executed).toEqual([
      expect.objectContaining({
        callerId: 'profile:cli',
        runAuthorizationOverride: 'ask-for-approval',
        hiveWake: true,
      }),
    ])
    expect(refused).toBe('refused')
    expect(revoked.mutations).toEqual([])
  })

  it('starts nothing when no update waits for the parent', async () => {
    installRuntime()
    const { layer, mutations } = harness({ candidate: undefined })

    const outcome = await Effect.runPromise(
      wakeIdleParent({ parentSessionId: QUEEN }, allowed).pipe(Effect.provide(layer)),
    )

    expect(outcome).toBe('not-needed')
    expect(mutations).toEqual([])
  })

  it('defers a wake a full Run limit refused, and reports other refusals', async () => {
    installRuntime()
    const candidate = {
      parentSessionId: QUEEN,
      latestRunId: 'run-parent',
      callerId: 'local-user',
      piSessionFile: null,
    }
    const wake = (rejectWith: string) =>
      Effect.runPromise(
        wakeIdleParent({ parentSessionId: QUEEN }, allowed).pipe(
          Effect.provide(harness({ candidate, rejectWith }).layer),
        ),
      )

    expect(await wake('host_run_ceiling_reached')).toBe('deferred')
    expect(await wake('parent_concurrency_limit_reached')).toBe('deferred')
    expect(await wake('profile_revoked')).toBe('refused')
    // The parent got a Run, a Follow-up, or was archived after the Host checked it.
    expect(await wake('hive_wake_not_needed')).toBe('not-needed')
  })

  it('asks for a wake only when no active parent Run took the update', async () => {
    const requests = captureWakeRequests()
    const delivery = (delivered: boolean) =>
      Layer.succeed(SessionOrchestrationUpdateDeliveryService, {
        deliverPendingToActiveRun: () => Effect.succeed(delivered),
        deliverPendingSpecificationsToActiveRun: () => Effect.succeed(false),
      })

    await Effect.runPromise(
      notifyParentOfOrchestrationUpdates(QUEEN, undefined).pipe(Effect.provide(delivery(true))),
    )
    await Effect.runPromise(
      notifyParentOfOrchestrationUpdates(QUEEN, undefined).pipe(Effect.provide(delivery(false))),
    )

    expect(requests).toEqual([{ parentSessionId: QUEEN }])
  })
})
