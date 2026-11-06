import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { DelegationSpecificationInput } from '@shared/types/session-lifecycle'
import { Context, type Effect } from 'effect'
import type { SessionControlRepositoryError } from '../errors'

export interface PendingSessionOrchestrationUpdate {
  readonly updateId: string
  readonly delegationId: string
  readonly workerSessionId: string
  readonly sourceRunId: string
  readonly state: 'ready_for_review' | 'needs_attention'
  readonly summary: string
  readonly createdAt: number
}

export interface PendingDelegationSpecificationUpdate {
  readonly updateId: string
  readonly delegationId: string
  readonly parentSessionId: string
  readonly workerSessionId: string
  readonly specificationRevision: number
  readonly specification: DelegationSpecificationInput
  readonly reason: string
  readonly createdAt: number
}

/**
 * An idle parent the Host should wake because Worker updates reached it that it never acted on
 * (`hive-parent-wake.ts`), with the caller its latest Run acted for, which the wake Run reuses.
 */
export interface HiveParentWakeCandidate {
  readonly parentSessionId: string
  /** The parent's latest Run, whose caller the wake acts for and whose initiator bounds it. */
  readonly latestRunId: string
  readonly callerId: string
  /** The latest Run's own Run mode override, which the wake keeps. */
  readonly runAuthorizationOverride?: AgentAuthorizationMode
  readonly piSessionFile: string | null
}

export interface HiveParentWakeQuery {
  readonly parentSessionId: string
}

export interface SessionOrchestrationUpdateRepositoryShape {
  readonly listPending: (input: {
    readonly parentSessionId: string
  }) => Effect.Effect<readonly PendingSessionOrchestrationUpdate[], SessionControlRepositoryError>
  readonly markDelivered: (input: {
    readonly updateIds: readonly string[]
    readonly parentSessionId: string
    readonly runId: string
    readonly itemIds: readonly string[]
    readonly deliveredAt: number
  }) => Effect.Effect<void, SessionControlRepositoryError>
  readonly listPendingSpecifications: (input: {
    readonly workerSessionId: string
  }) => Effect.Effect<
    readonly PendingDelegationSpecificationUpdate[],
    SessionControlRepositoryError
  >
  /**
   * The parent, if it is idle, not archived, has no queued Follow-up, its latest Run completed or
   * failed (a stopped Run is the user's choice), and an update reached it that no Run acted on.
   * Optional so test doubles that never wake keep compiling.
   */
  readonly parentWakeCandidate?: (
    input: HiveParentWakeQuery,
  ) => Effect.Effect<HiveParentWakeCandidate | undefined, SessionControlRepositoryError>
  readonly markSpecificationsDelivered: (input: {
    readonly updateIds: readonly string[]
    readonly workerSessionId: string
    readonly runId: string
    readonly itemIds: readonly string[]
    readonly deliveredAt: number
  }) => Effect.Effect<void, SessionControlRepositoryError>
}

export class SessionOrchestrationUpdateRepository extends Context.Tag(
  '@openwaggle/SessionOrchestrationUpdateRepository',
)<SessionOrchestrationUpdateRepository, SessionOrchestrationUpdateRepositoryShape>() {}
