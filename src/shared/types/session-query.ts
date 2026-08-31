import type { AgentLoopInteraction } from './agent-loop-interaction'
import type { DelegationState } from './session-collaboration'
import type {
  DelegationConflictKind,
  DelegationConflictStatus,
  DelegationConflictsQueryOutcome,
  DelegationListQueryOutcome,
  DelegationReadQueryOutcome,
} from './session-delegation-query'
import type { SessionExportOutcome, SessionExportQuery } from './session-export'
import type {
  SessionExportOperationQuery,
  SessionExportOperationQueryOutcome,
} from './session-export-operation'
import type { SessionHostEventCursor } from './session-host-event'
import type {
  SemanticDiscoveryReadiness,
  SessionDiscoveryMode,
  SessionQuerySummary,
} from './session-query-discovery'
import type { SessionWaitState } from './session-wait'

export type { DelegationQuerySummary } from './session-delegation-query'
export type {
  SemanticDiscoveryReadiness,
  SessionDiscoveryEvidence,
  SessionDiscoveryMode,
  SessionLineageRole,
  SessionQuerySummary,
} from './session-query-discovery'
export type { SessionQueryResponse } from './session-query-response'
export {
  SESSION_QUERY_MAX_WAIT_MS,
  SESSION_QUERY_WAIT_TARGET_LIMIT,
  type SessionWaitState,
} from './session-wait'
export const SESSION_QUERY_OPERATIONS = [
  'list',
  'search',
  'read',
  'turns',
  'items',
  'export',
  'exports-list',
  'exports-read',
  'exports-wait',
  'status',
  'queue-list',
  'requests-list',
  'delegations-list',
  'delegations-read',
  'delegations-conflicts',
  'wait',
] as const

export const SESSION_QUERY_CONTRACT_VERSION = 2 as const
export const SESSION_QUERY_DISCOVERY_LIMIT = 200
export const SESSION_QUERY_TRANSCRIPT_LIMIT = 500
export const SESSION_QUERY_MAX_SEARCH_LENGTH = 4_096
export const SESSION_QUERY_MAX_CURSOR_LENGTH = 4_096
export const SESSION_QUERY_MAX_PATH_LENGTH = 4_096

export type SessionQuery =
  | {
      readonly operation: 'list'
      readonly limit: number
      readonly cursor?: string
      readonly archived?: boolean
      readonly projectPath?: string
      readonly workingPath?: string
    }
  | {
      readonly operation: 'search'
      readonly query: string
      readonly limit: number
      readonly cursor?: string
      readonly projectPath?: string
      readonly workingPath?: string
      readonly includeArchived?: boolean
      readonly searchScope?: 'discovery' | 'full-transcript'
      readonly mode?: SessionDiscoveryMode
      readonly requireFresh?: boolean
      readonly waitTimeoutMs?: number
    }
  | { readonly operation: 'read'; readonly sessionId: string }
  | {
      readonly operation: 'turns'
      readonly sessionId: string
      readonly limit: number
      readonly cursor?: string
    }
  | {
      readonly operation: 'items'
      readonly sessionId: string
      readonly limit: number
      readonly runId?: string
      readonly afterCreatedOrder?: number
      readonly throughCreatedOrder?: number
    }
  | SessionExportQuery
  | SessionExportOperationQuery
  | { readonly operation: 'status'; readonly sessionId: string }
  | {
      readonly operation: 'queue-list'
      readonly sessionId: string
      readonly includeBodies?: boolean
    }
  | {
      readonly operation: 'requests-list'
      readonly sessionId: string
    }
  | {
      readonly operation: 'delegations-list'
      readonly limit: number
      readonly cursor?: string
      readonly projectPath?: string
      readonly workingPath?: string
      readonly parentSessionId?: string
      readonly workerSessionId?: string
      readonly states?: readonly DelegationState[]
    }
  | { readonly operation: 'delegations-read'; readonly delegationId: string }
  | {
      readonly operation: 'delegations-conflicts'
      readonly limit: number
      readonly cursor?: string
      readonly projectPath?: string
      readonly workingPath?: string
      readonly parentSessionId?: string
      readonly workerSessionId?: string
      readonly delegationId?: string
      readonly kinds?: readonly DelegationConflictKind[]
      readonly statuses?: readonly DelegationConflictStatus[]
    }
  | {
      readonly operation: 'wait'
      readonly targets: readonly (
        | { readonly sessionId: string; readonly condition: 'idle' }
        | { readonly sessionId: string; readonly condition: 'queue-empty' }
        | {
            readonly sessionId: string
            readonly condition: 'state-revision-after'
            readonly afterStateRevision: number
          }
      )[]
      readonly timeoutMs: number
      readonly after?: SessionHostEventCursor
    }

export interface SessionQueryRequest {
  readonly contractVersion: typeof SESSION_QUERY_CONTRACT_VERSION
  readonly requestId: string
  readonly query: SessionQuery
}

export type SessionQueryOutcome =
  | {
      readonly operation: 'list' | 'search'
      readonly sessions: readonly SessionQuerySummary[]
      readonly nextCursor?: string
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
  | {
      readonly operation: 'items'
      readonly sessionId: string
      readonly items: readonly {
        readonly nodeId: string
        readonly parentNodeId: string | null
        readonly role: string | null
        readonly kind: string
        readonly timestampMs: number
        readonly createdOrder: number
        readonly runId?: string
        readonly content: unknown
        readonly metadata: unknown
      }[]
      readonly highWaterMark: number
      readonly nextCreatedOrder?: number
    }
  | SessionExportOutcome
  | SessionExportOperationQueryOutcome
  | {
      readonly operation: 'status'
      readonly sessionId: string
      readonly stateRevision: number
      readonly queueState: 'running' | 'paused'
      readonly queueRevision: number
      readonly activeRunId: string | null
      readonly activeRunStatus?: string
      readonly pendingFollowUpCount: number
    }
  | {
      readonly operation: 'queue-list'
      readonly sessionId: string
      readonly queueState: 'running' | 'paused'
      readonly queueRevision: number
      readonly activeRunId: string | null
      readonly items: readonly {
        readonly followUpId: string
        readonly position: number
        readonly createdAt: number
        readonly deliveryState: 'pending' | 'needs_attention'
        readonly attentionReason?:
          | 'authorization_ceiling_changed'
          | 'profile_revoked'
          | 'authority_changed'
        readonly intent?: unknown
      }[]
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
          | 'resync_required'
          | 'host_stopped'
        readonly message: string
      }
    }
