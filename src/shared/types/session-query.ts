import type { SchemaType } from '@shared/schema'
import type { sessionQueryRequestSchema, sessionQuerySchema } from '@shared/schemas/session-query'
import type { SessionHostErrorKind } from '../domain/session-host-refusals'
import type { AgentLoopInteraction } from './agent-loop-interaction'
import type { HiveNextActor } from './hive-next-actor'
import type { DelegationState } from './session-collaboration'
import type { FollowUpQueuePauseReason, SessionFollowUpListing } from './session-control-queue'
import type {
  DelegationConflictsQueryOutcome,
  DelegationListQueryOutcome,
  DelegationReadQueryOutcome,
} from './session-delegation-query'
import type { SessionExportOutcome } from './session-export'
import type { SessionExportOperationQueryOutcome } from './session-export-operation'
import type { SessionHostEventCursor } from './session-host-event'
import type {
  SemanticDiscoveryReadiness,
  SessionDiscoveryMode,
  SessionQuerySummary,
} from './session-query-discovery'
import type { SessionItemsOutcome } from './session-query-items'
import type { SessionWaitState } from './session-wait'

export type { DelegationQuerySummary } from './session-delegation-query'
export type {
  SemanticDiscoveryReadiness,
  SessionDiscoveryMode,
  SessionQuerySummary,
} from './session-query-discovery'
export type { SessionQueryResponse } from './session-query-response'
export {
  SESSION_QUERY_MAX_WAIT_MS,
  SESSION_QUERY_WAIT_TARGET_LIMIT,
  type SessionWaitState,
} from './session-wait'

export const SESSION_QUERY_CONTRACT_VERSION = 2 as const
// Keep query pages below the Local Session transport's 64 MiB logical-message ceiling.
// The margin covers protocol envelopes and leaves room for future additive fields.
export const SESSION_QUERY_MAX_RESPONSE_BYTES = 48 * 1024 * 1024
export const SESSION_QUERY_DISCOVERY_LIMIT = 200
export const SESSION_QUERY_TRANSCRIPT_LIMIT = 500
export const SESSION_QUERY_DELEGATION_READ_LIMIT = 200
export const SESSION_QUERY_MAX_SEARCH_LENGTH = 4_096
export const SESSION_QUERY_MAX_CURSOR_LENGTH = 4_096
export const SESSION_QUERY_MAX_PATH_LENGTH = 4_096
export const SESSION_QUERY_PROJECT_PATH_FILTER_LIMIT = 1_000

export type SessionQuery = SchemaType<typeof sessionQuerySchema>

export type SessionQueryRequest = SchemaType<typeof sessionQueryRequestSchema>

export type SessionQueryOutcome =
  | {
      readonly operation: 'list' | 'search'
      readonly sessions: readonly SessionQuerySummary[]
      readonly nextCursor?: string
      /** Exact match count for indexed list filters that provide it. */
      readonly totalCount?: number
      readonly searchBackend?: SessionDiscoveryMode
      readonly requestedSearchMode?: SessionDiscoveryMode
      readonly semanticReadiness?: SemanticDiscoveryReadiness
      readonly degradation?: {
        readonly from: 'hybrid'
        readonly to: 'lexical'
        readonly reason: string
      }
      readonly discoveryWindow?: {
        readonly size: number
        readonly truncated: boolean
        readonly expiresAt: number
      }
    }
  | {
      readonly operation: 'read'
      readonly session: SessionQuerySummary
      readonly workspace: {
        readonly workspaceId: string
        readonly kind: 'local' | 'managed-worktree'
        readonly workingPath: string
        readonly lifecycleState: string
      }
      readonly runtime: {
        readonly stateRevision: number
        readonly activeRunId: string | null
        readonly activeRunStatus?: string
      }
      readonly queue: {
        readonly state: 'running' | 'paused'
        readonly revision: number
        readonly pendingCount: number
      }
      readonly delegation?: {
        readonly delegationId: string
        readonly state: DelegationState
        /** Who acts next on the Worker (ADR 0059), derived at read time. */
        readonly nextActor?: HiveNextActor
        readonly currentSpecificationRevision: number
        readonly latestSubmissionRevision: number
      }
    }
  | {
      readonly operation: 'turns'
      readonly sessionId: string
      readonly turns: readonly {
        readonly runId: string
        readonly status: string
        readonly createdAt: number
        readonly updatedAt: number
        readonly nodeCount: number
        readonly firstCreatedOrder?: number
        readonly lastCreatedOrder?: number
      }[]
      readonly nextCursor?: string
    }
  | SessionItemsOutcome
  | SessionExportOutcome
  | SessionExportOperationQueryOutcome
  | {
      readonly operation: 'status'
      readonly sessionId: string
      readonly stateRevision: number
      readonly queueState: 'running' | 'paused'
      /** Why a paused queue paused, when the Host recorded it. */
      readonly queuePauseReason?: FollowUpQueuePauseReason
      readonly queueRevision: number
      readonly activeRunId: string | null
      readonly activeRunStatus?: string
      readonly pendingFollowUpCount: number
      /** Earliest live Follow-up edit hold: the queue is waiting on the user's edit. */
      readonly followUpEditHeldAt?: number
    }
  | {
      readonly operation: 'queue-list'
      readonly sessionId: string
      readonly queueState: 'running' | 'paused'
      /** Why a paused queue paused, when the Host recorded it. */
      readonly queuePauseReason?: FollowUpQueuePauseReason
      readonly queueRevision: number
      readonly activeRunId: string | null
      readonly items: readonly (SessionFollowUpListing & {
        readonly followUpId: string
        readonly position: number
        readonly createdAt: number
        readonly deliveryState: 'pending' | 'needs_attention'
        readonly attentionReason?: 'profile_revoked' | 'authority_changed'
        /**
         * Set when a direct steer became this Follow-up because its Run stopped before
         * incorporating it. `idempotencyKey` is the steer's, so its caller can recognise it.
         */
        readonly returnedSteer?: { readonly runId: string; readonly idempotencyKey: string }
        readonly intent?: unknown
      })[]
      readonly omittedBodyCount: number
    }
  | {
      readonly operation: 'requests-list'
      readonly sessionId: string
      readonly requests: readonly AgentLoopInteraction[]
    }
  | DelegationListQueryOutcome
  | DelegationReadQueryOutcome
  | DelegationConflictsQueryOutcome
  | {
      readonly operation: 'wait'
      readonly timedOut: boolean
      readonly matchedSessionIds: readonly string[]
      readonly cursor: SessionHostEventCursor
      readonly states: readonly SessionWaitState[]
    }
  | {
      readonly operation: SessionQuery['operation']
      readonly semanticReadiness?: SemanticDiscoveryReadiness
      readonly error: {
        readonly code:
          | 'session_not_found'
          | 'branch_not_found'
          | 'delegation_not_found'
          | 'export_not_found'
          | 'invalid_cursor'
          | 'cursor_expired'
          | 'cursor_mismatch'
          | 'semantic_not_ready'
          | 'record_too_large'
          | 'resync_required'
          | 'host_stopped'
        readonly kind: SessionHostErrorKind // From the Session Host's refusal table (ADR 0063).
        readonly message: string
      }
    }
