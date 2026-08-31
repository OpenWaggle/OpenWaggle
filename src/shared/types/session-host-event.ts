import type {
  SessionExportOperationStatus,
  SessionExportProgress,
} from './session-export-operation'
import type { SemanticDiscoveryReadiness } from './session-query'
import type { AgentTransportEvent } from './stream'
import type { WaggleStreamMetadata, WaggleTurnEvent } from './waggle'

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
      readonly kind: 'session-state-changed'
      readonly sessionId: string
      readonly stateRevision: number
      readonly operation: string
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
      readonly kind: 'session-export-changed'
      readonly sessionId: string
      readonly exportOperationId: string
      readonly status: SessionExportOperationStatus
      readonly progress: SessionExportProgress
    }

export interface SessionHostEventEnvelope {
  readonly cursor: SessionHostEventCursor
  readonly timestamp: number
  readonly payload: SessionHostEventPayload
}

export type SessionHostEventReplayResult =
  | {
      readonly status: 'ready'
      readonly events: readonly SessionHostEventEnvelope[]
      readonly cursor: SessionHostEventCursor
    }
  | {
      readonly status: 'resync-required'
      readonly reason: 'host-restarted' | 'cursor-expired' | 'cursor-ahead' | 'slow-consumer'
      readonly cursor: SessionHostEventCursor
    }

export type SessionHostEventDelivery =
  | { readonly status: 'event'; readonly event: SessionHostEventEnvelope }
  | { readonly status: 'cursor-advanced'; readonly cursor: SessionHostEventCursor }
  | {
      readonly status: 'resync-required'
      readonly reason: 'slow-consumer'
      readonly cursor: SessionHostEventCursor
    }
  | { readonly status: 'closed' }
