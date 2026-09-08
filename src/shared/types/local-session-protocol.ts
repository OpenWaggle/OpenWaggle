import type {
  LOCAL_SESSION_CAPABILITIES,
  LOCAL_SESSION_CURRENT_REVISION,
  LOCAL_SESSION_REVISION_8_CAPABILITIES,
} from './local-session-protocol-revisions'
export const LOCAL_SESSION_PROTOCOL_NAME = 'openwaggle-local-session' as const
export const LOCAL_SESSION_MAX_CLIENT_VERSION_LENGTH = 128
export const LOCAL_SESSION_MAX_SUPPORTED_REVISIONS = 16
export const LOCAL_SESSION_SUBSCRIPTION_SESSION_LIMIT = 128
export * from './local-session-protocol-revisions'
export { SESSION_WAGGLE_CONTRACT_VERSION } from './local-session-waggle'

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
                readonly lastVisitedAt?: number
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
  | {
      readonly contract: 'host-ui-v1'
      readonly request: HostUiV1Request
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
  | {
      readonly contract: 'host-ui-v1'
      readonly response: HostUiV1Result
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
      readonly sessionIds?: readonly string[]
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

export interface AcceptedLocalSessionNegotiation<Revision extends number, Capabilities> {
  readonly accepted: true
  readonly protocol: typeof LOCAL_SESSION_PROTOCOL_NAME
  readonly revision: Revision
  readonly hostInstanceId: string
  readonly capabilities: Capabilities
}

export type LocalSessionNegotiationResult =
  | AcceptedLocalSessionNegotiation<
      typeof LOCAL_SESSION_CURRENT_REVISION,
      typeof LOCAL_SESSION_CAPABILITIES
    >
  | AcceptedLocalSessionNegotiation<8, typeof LOCAL_SESSION_REVISION_8_CAPABILITIES>
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
import type { HostUiV1Request, HostUiV1Result } from './host-ui-protocol'
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
