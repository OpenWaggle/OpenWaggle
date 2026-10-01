import { FollowUpId, ReportCorrelationId, ReportId, RunId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { vi } from 'vitest'
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
import { noUndeliveredSteers } from './agent-steering-test-layer'

export function makePromotionReplacementLayer(
  initialState: SessionControlSessionState,
  options?: {
    readonly interrupt?: (
      input: AgentRunInterruptionInput,
    ) => Effect.Effect<AgentRunInterruptionResult>
    readonly steeringAccepted?: boolean
    readonly release?: () => Effect.Effect<void, Error>
  },
) {
  let state = initialState
  const steer = vi.fn((_input: unknown) =>
    options?.steeringAccepted === false
      ? { accepted: false as const, code: 'run_not_live' as const }
      : { accepted: true as const, receipt: { delivery: 'handled' as const } },
  )
  const interrupt = vi.fn((_input: unknown) => ({ accepted: true as const }))
  const release = vi.fn(() => Effect.void)
  return {
    steer,
    interrupt,
    release,
    state: () => state,
    /** Change the state as a concurrent writer would, for example a settling Run. */
    updateState: (update: (current: SessionControlSessionState) => SessionControlSessionState) => {
      state = update(state)
    },
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
            return input.outcomeForFinalState ? input.outcomeForFinalState(state) : input.outcome
          }),
      }),
      Layer.succeed(SessionControlAttachmentService, {
        prepare: () => Effect.succeed([]),
        bind: () => Effect.void,
        cleanupUnreferenced: () => Effect.void,
        resolve: () => Effect.succeed([]),
        release: () => options?.release?.() ?? release(),
      }),
      Layer.succeed(AgentSteeringService, {
        steer: (input) => Effect.succeed(steer(input)),
        ...noUndeliveredSteers,
      }),
      Layer.succeed(AgentRunInterruptionService, {
        requestInterrupt: (input) => Effect.succeed(interrupt(input)),
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
