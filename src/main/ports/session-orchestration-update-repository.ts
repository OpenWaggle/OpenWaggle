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
