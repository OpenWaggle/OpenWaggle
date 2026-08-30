export const LOCAL_SESSION_PROTOCOL_NAME = 'openwaggle-local-session' as const
export { SESSION_WAGGLE_CONTRACT_VERSION } from './local-session-waggle'
export const LOCAL_SESSION_CURRENT_REVISION = 4 as const
export const LOCAL_SESSION_WAGGLE_REVISION = 3 as const
export const LOCAL_SESSION_SUPPORTED_REVISIONS = [4, 3, 2] as const

export const LOCAL_SESSION_REVISION_2_CAPABILITIES = [
  'events:subscribe',
  'events:replay',
  'sessions:mutate-v2',
  'sessions:query-v2',
  'sessions:snapshot',
  'access:profiles-v1',
  'ui:mutate-v1',
] as const

export const LOCAL_SESSION_REVISION_3_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_2_CAPABILITIES,
  'waggle:run-v1',
  'waggle:cancel-v1',
] as const

export const LOCAL_SESSION_CAPABILITIES = [
  ...LOCAL_SESSION_REVISION_3_CAPABILITIES,
  'ui:compact-v1',
] as const

export interface LocalSessionClientHello {
  readonly protocol: typeof LOCAL_SESSION_PROTOCOL_NAME
  readonly supportedRevisions: readonly number[]
  readonly clientKind: 'gui' | 'cli' | 'mcp' | 'internal'
  readonly clientVersion: string
  readonly workingDirectory?: string
  readonly profile?: string
  readonly transientAuthority?: LocalSessionProfileAuthority
  readonly credential?: string
}

export type LocalSessionCommandPayload =
  | {
      readonly contract: 'local-attachments-v1'
      readonly request: {
        readonly requestId: string
        readonly entries: readonly {
          readonly path: string
          readonly origin?: AttachmentOrigin
        }[]
      }
    }
  | {
      readonly contract: 'local-ui-v1'
      readonly request: {
        readonly requestId: string
        readonly command:
          | { readonly operation: 'pin'; readonly sessionId: string }
          | { readonly operation: 'unpin'; readonly sessionId: string }
          | {
              readonly operation: 'move-pin'
              readonly sessionId: string
              readonly afterSessionId: string | null
              readonly beforeSessionId: string | null
            }
          | {
              readonly operation: 'dismiss-interrupted-run'
              readonly sessionId: string
              readonly runId: string
            }
          | {
              readonly operation: 'navigate-tree'
              readonly sessionId: string
              readonly model: string
              readonly targetNodeId: string
              readonly options?: SessionNavigateTreeOptions
            }
          | {
              readonly operation: 'rename-branch'
              readonly sessionId: string
              readonly branchId: string
              readonly name: string
            }
          | {
              readonly operation: 'archive-branch'
              readonly sessionId: string
              readonly branchId: string
            }
          | {
              readonly operation: 'restore-branch'
              readonly sessionId: string
              readonly branchId: string
            }
          | {
              readonly operation: 'update-tree-ui-state'
              readonly sessionId: string
              readonly patch: {
                readonly expandedNodeIds?: readonly string[]
                readonly branchesSidebarCollapsed?: boolean
              }
            }
          | { readonly operation: 'delete'; readonly sessionId: string }
      }
    }
  | {
      readonly contract: 'local-access-v1'
      readonly request: LocalSessionProfileManagementRequest
    }
  | {
      readonly contract: 'session-control-v2'
      readonly request: SessionControlMutationRequest
      readonly transport?: { readonly attachmentPaths: readonly string[] }
    }
  | {
      readonly contract: 'session-lifecycle-v2'
      readonly request: SessionLifecycleRequest
      readonly transport?: { readonly attachmentPaths: readonly string[] }
    }
  | {
      readonly contract: 'session-query-v2'
      readonly request: SessionQueryRequest
    }
  | LocalSessionCompactionCommandPayload
  | LocalSessionWaggleCommandPayload

export type LocalSessionCommandResult =
  | {
      readonly contract: 'local-attachments-v1'
      readonly response: {
        readonly requestId: string
        readonly attachments: readonly PreparedAttachment[]
      }
    }
  | {
      readonly contract: 'local-ui-v1'
      readonly response: {
        readonly requestId: string
        readonly effect:
          | 'pinned'
          | 'unpinned'
          | 'pin-moved'
          | 'interrupted-run-dismissed'
          | 'tree-navigated'
          | 'branch-renamed'
          | 'branch-archived'
          | 'branch-restored'
          | 'tree-ui-state-updated'
          | 'session-deleted'
        readonly sessionId: string
        readonly navigation?: { readonly editorText?: string; readonly cancelled: boolean }
      }
    }
  | {
      readonly contract: 'local-access-v1'
      readonly response: LocalSessionProfileManagementResponse
    }
  | {
      readonly contract: 'session-control-v2'
      readonly response: SessionControlMutationResponse
    }
  | {
      readonly contract: 'session-lifecycle-v2'
      readonly response: SessionLifecycleResponse
    }
  | {
      readonly contract: 'session-query-v2'
      readonly response: SessionQueryResponse
    }
  | LocalSessionCompactionCommandResult
  | LocalSessionWaggleCommandResult

export type LocalSessionClientFrame =
  | {
      readonly kind: 'command'
      readonly requestId: string
      readonly payload: unknown
    }
  | {
      readonly kind: 'subscribe'
      readonly requestId: string
      readonly after?: SessionHostEventCursor
    }
  | {
      readonly kind: 'unsubscribe'
      readonly requestId: string
      readonly subscriptionId: string
    }

export type LocalSessionServerFrame =
  | {
      readonly kind: 'response'
      readonly requestId: string
      readonly payload: unknown
    }
  | {
      readonly kind: 'error'
      readonly requestId?: string
      readonly code: string
      readonly message: string
      readonly retryable: boolean
    }
  | {
      readonly kind: 'subscribed'
      readonly requestId: string
      readonly subscriptionId: string
      readonly cursor: SessionHostEventCursor
      readonly activeRuns?: readonly BackgroundRunSnapshot[]
    }
  | {
      readonly kind: 'unsubscribed'
      readonly requestId: string
      readonly subscriptionId: string
    }
  | {
      readonly kind: 'event'
      readonly subscriptionId: string
      readonly event: SessionHostEventEnvelope
    }
  | {
      readonly kind: 'cursor-advanced'
      readonly subscriptionId: string
      readonly cursor: SessionHostEventCursor
    }
  | {
      readonly kind: 'resync-required'
      readonly requestId?: string
      readonly subscriptionId?: string
      readonly reason: 'host-restarted' | 'cursor-expired' | 'cursor-ahead' | 'slow-consumer'
      readonly cursor: SessionHostEventCursor
    }
  | {
      readonly kind: 'subscription-closed'
      readonly subscriptionId: string
    }

export type LocalSessionNegotiationResult =
  | {
      readonly accepted: true
      readonly protocol: typeof LOCAL_SESSION_PROTOCOL_NAME
      readonly revision: typeof LOCAL_SESSION_CURRENT_REVISION
      readonly hostInstanceId: string
      readonly capabilities: typeof LOCAL_SESSION_CAPABILITIES
    }
  | {
      readonly accepted: true
      readonly protocol: typeof LOCAL_SESSION_PROTOCOL_NAME
      readonly revision: 3
      readonly hostInstanceId: string
      readonly capabilities: typeof LOCAL_SESSION_REVISION_3_CAPABILITIES
    }
  | {
      readonly accepted: true
      readonly protocol: typeof LOCAL_SESSION_PROTOCOL_NAME
      readonly revision: 2
      readonly hostInstanceId: string
      readonly capabilities: typeof LOCAL_SESSION_REVISION_2_CAPABILITIES
    }
  | {
      readonly accepted: false
      readonly protocol: typeof LOCAL_SESSION_PROTOCOL_NAME
      readonly code: 'incompatible_protocol'
      readonly supportedRevisions: readonly number[]
    }
  | {
      readonly accepted: false
      readonly protocol: typeof LOCAL_SESSION_PROTOCOL_NAME
      readonly code: 'host_upgrade_pending'
      readonly hostInstanceId: string
      readonly supportedRevisions: readonly number[]
      readonly blockingRuns: readonly {
        readonly sessionId: string
        readonly runId: string
      }[]
      readonly blockingOperations: readonly {
        readonly operationId: string
        readonly operation: string
        readonly targetScope: string
      }[]
    }

import type { AttachmentOrigin, PreparedAttachment } from './agent'
import type { BackgroundRunSnapshot } from './background-run'
import type {
  LocalSessionCompactionCommandPayload,
  LocalSessionCompactionCommandResult,
} from './local-session-compaction'
import type { LocalSessionProfileAuthority } from './local-session-profile'
import type {
  LocalSessionProfileManagementRequest,
  LocalSessionProfileManagementResponse,
} from './local-session-profile-management'
import type {
  LocalSessionWaggleCommandPayload,
  LocalSessionWaggleCommandResult,
} from './local-session-waggle'
import type { SessionNavigateTreeOptions } from './session'
import type {
  SessionControlMutationRequest,
  SessionControlMutationResponse,
} from './session-control'
import type { SessionHostEventCursor, SessionHostEventEnvelope } from './session-host-event'
import type { SessionLifecycleRequest, SessionLifecycleResponse } from './session-lifecycle'
import type { SessionQueryRequest, SessionQueryResponse } from './session-query'
