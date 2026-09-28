import type { SessionId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'
import type { SessionControlRepositoryError } from '../errors'

/**
 * A Worker Session whose Delegation Contract is terminal, that is fully idle, and that no user
 * (GUI, CLI, MCP, or any other non-agent caller) has ever acted on.
 */
export interface HiveWorkerCleanupCandidate {
  readonly workerSessionId: SessionId
  readonly parentSessionId: SessionId
  /** The exact agent caller that spawned the Worker; the Host archives on its behalf. */
  readonly parentCallerId: string
  readonly delegationId: string
  readonly delegationState: 'accepted' | 'cancelled'
  readonly delegationUpdatedAt: number
}

export interface HiveWorkerCleanupRepositoryShape {
  /**
   * Returns eligible Workers among `sessionId` itself and, when requested, its direct Workers.
   * Eligibility is derived only from durable Session Host records.
   */
  readonly findEligibleWorkers: (input: {
    readonly sessionId: SessionId
    readonly includeDirectWorkers: boolean
  }) => Effect.Effect<readonly HiveWorkerCleanupCandidate[], SessionControlRepositoryError>
}

export class HiveWorkerCleanupRepository extends Context.Tag(
  '@openwaggle/HiveWorkerCleanupRepository',
)<HiveWorkerCleanupRepository, HiveWorkerCleanupRepositoryShape>() {}
