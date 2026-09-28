import type { SessionId } from '@shared/types/brand'
import type {
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from '@shared/types/session-control'
import { Context, type Effect } from 'effect'
import type { SessionControlRepositoryError } from '../errors'

/** Callers with this prefix are agent Runs; every other caller is a user (GUI, CLI, profile, MCP). */
export const HIVE_AGENT_CALLER_PREFIX = 'session-agent:'

export function isHiveAgentCaller(callerId: string) {
  return callerId.startsWith(HIVE_AGENT_CALLER_PREFIX)
}

/** Idempotency-key prefix of every Hive cleanup archive; restore recognizes it in the journal. */
export const HIVE_CLEANUP_IDEMPOTENCY_PREFIX = 'hive-cleanup:'

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

/** Request envelope fields shared by the Host-authored archive and restore mutations. */
export type HiveWorkerMutationEnvelope = Pick<
  SessionControlMutationRequest,
  'contractVersion' | 'requestId' | 'idempotencyKey'
>

export type HiveWorkerArchiveResult =
  | { readonly status: 'archived'; readonly response: SessionControlMutationResponse }
  /** Eligibility changed after the scan, or the parent agent no longer holds live authority. */
  | { readonly status: 'kept'; readonly reason: 'ineligible' | 'parent-authority-revoked' }

export interface HiveWorkerCleanupRepositoryShape {
  /**
   * Returns eligible Workers among `sessionId` itself and, when requested, its direct Workers.
   * Eligibility is derived only from durable Session Host records.
   */
  readonly findEligibleWorkers: (input: {
    readonly sessionId: SessionId
    readonly includeDirectWorkers: boolean
  }) => Effect.Effect<readonly HiveWorkerCleanupCandidate[], SessionControlRepositoryError>
  /**
   * Archive `candidate` on behalf of its parent agent in one write transaction that re-derives
   * the full eligibility predicate and the parent's live authority first. A pin, branch, or user
   * operation that committed after the scan therefore keeps the Worker.
   */
  readonly archiveIfStillEligible: (input: {
    readonly candidate: HiveWorkerCleanupCandidate
    readonly envelope: HiveWorkerMutationEnvelope
  }) => Effect.Effect<HiveWorkerArchiveResult, SessionControlRepositoryError>
  /**
   * If `sessionId` is archived and its latest archive-state change is a Hive cleanup archive,
   * unarchive it attributed to `callerId`. Returns `undefined` when the Session is not in that
   * state (never archived, restored, or archived explicitly by a user or agent).
   */
  readonly restoreCleanupArchive: (input: {
    readonly callerId: string
    readonly sessionId: SessionId
    readonly envelope: HiveWorkerMutationEnvelope
  }) => Effect.Effect<SessionControlMutationResponse | undefined, SessionControlRepositoryError>
}

export class HiveWorkerCleanupRepository extends Context.Tag(
  '@openwaggle/HiveWorkerCleanupRepository',
)<HiveWorkerCleanupRepository, HiveWorkerCleanupRepositoryShape>() {}
