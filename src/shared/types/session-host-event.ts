import type { RunMode, WorktreeLaunchProgress } from './background-run'
import type { SupportedModelId } from './brand'
import type {
  SessionExportOperationStatus,
  SessionExportProgress,
} from './session-export-operation'
import type { SemanticDiscoveryReadiness } from './session-query'
import type { ThinkingLevel } from './settings'
import type { AgentTransportEvent } from './stream'
import type { WaggleStreamMetadata, WaggleTurnEvent } from './waggle'

export type SessionRunTerminalStatus =
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'interrupted-by-interaction-timeout'

export interface SessionHostEventCursor {
  readonly hostInstanceId: string
  readonly sequence: number
}

export type SessionHostEventPayload =
  | {
      readonly kind: 'session-transport'
      readonly sessionId: string
      readonly event: AgentTransportEvent
    }
  | {
      readonly kind: 'session-worktree-launch'
      readonly sessionId: string
      readonly model: SupportedModelId
      readonly mode: RunMode
      readonly event:
        | { readonly type: 'progress'; readonly progress: WorktreeLaunchProgress }
        | { readonly type: 'failure'; readonly errorMessage: string }
    }
  | {
      readonly kind: 'session-state-changed'
      readonly sessionId: string
      readonly stateRevision: number
      readonly operation: string
      /** For `run-settled` and `follow-up-started`: the Run that settled. */
      readonly runId?: string
      readonly terminalStatus?: SessionRunTerminalStatus
      /**
       * The Run failed after its terminal event reported a clean end (it could not be saved). Only
       * the classification code: messages stay on the transport, which needs `sessions:read`.
       */
      readonly failureCode?: string
    }
  | {
      readonly kind: 'session-waggle-transport'
      readonly sessionId: string
      readonly event: AgentTransportEvent
      readonly meta: WaggleStreamMetadata
    }
  | {
      readonly kind: 'session-waggle-turn'
      readonly sessionId: string
      readonly event: WaggleTurnEvent
    }
  | {
      readonly kind: 'session-list-changed'
      readonly sessionId: string
      readonly change: 'created' | 'updated' | 'archived' | 'unarchived' | 'deleted'
    }
  | {
      readonly kind: 'semantic-discovery-readiness-changed'
      readonly readiness: SemanticDiscoveryReadiness
    }
  | {
      /**
       * Pi's global default thinking level changed (the desktop user picked a level), so every
       * window's draft picker shows where the next new Session starts.
       */
      readonly kind: 'default-thinking-level-changed'
      readonly level: ThinkingLevel
    }
  | {
      readonly kind: 'session-export-changed'
      readonly sessionId: string
      readonly exportOperationId: string
      readonly status: SessionExportOperationStatus
      readonly progress: SessionExportProgress
    }

/** Host events about the app rather than one Session; only unscoped desktop callers see them. */
export type SessionlessHostEventPayload = Extract<
  SessionHostEventPayload,
  { readonly kind: 'semantic-discovery-readiness-changed' | 'default-thinking-level-changed' }
>

export type SessionScopedHostEventPayload = Exclude<
  SessionHostEventPayload,
  SessionlessHostEventPayload
>

export function isSessionlessHostEvent(
  payload: SessionHostEventPayload,
): payload is SessionlessHostEventPayload {
  return (
    payload.kind === 'semantic-discovery-readiness-changed' ||
    payload.kind === 'default-thinking-level-changed'
  )
}

export interface SessionHostEventEnvelope {
  readonly cursor: SessionHostEventCursor
  readonly timestamp: number
  readonly payload: SessionHostEventPayload
}

export type SessionHostEventResyncReason =
  | 'host-restarted'
  | 'cursor-expired'
  | 'cursor-ahead'
  | 'slow-consumer'

export type SessionHostEventReplayResult =
  | {
      readonly status: 'ready'
      readonly events: readonly SessionHostEventEnvelope[]
      readonly cursor: SessionHostEventCursor
    }
  | {
      readonly status: 'resync-required'
      readonly reason: SessionHostEventResyncReason
      readonly cursor: SessionHostEventCursor
    }

export type SessionHostEventDelivery =
  | { readonly status: 'event'; readonly event: SessionHostEventEnvelope }
  | { readonly status: 'cursor-advanced'; readonly cursor: SessionHostEventCursor }
  | {
      readonly status: 'resync-required'
      readonly reason: SessionHostEventResyncReason
      readonly cursor: SessionHostEventCursor
    }
  | { readonly status: 'closed' }
