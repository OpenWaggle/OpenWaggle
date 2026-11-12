import type { SchemaType } from '@shared/schema'
import type { localSessionCommandResultSchema } from '@shared/schemas/local-session-command-response'
import type { localSessionNegotiationResultSchema } from '@shared/schemas/local-session-negotiation'
import type {
  localSessionClientHelloSchema,
  localSessionCommandPayloadSchema,
} from '@shared/schemas/local-session-protocol'
import type { SessionHostErrorKind } from '../domain/session-host-refusals'
import type { BackgroundRunSnapshot } from './background-run'
import type { SessionHostEventCursor, SessionHostEventEnvelope } from './session-host-event'
export const LOCAL_SESSION_PROTOCOL_NAME = 'openwaggle-local-session' as const
export const LOCAL_SESSION_MAX_CLIENT_VERSION_LENGTH = 128
export const LOCAL_SESSION_MAX_SUPPORTED_REVISIONS = 16
export const LOCAL_SESSION_SUBSCRIPTION_SESSION_LIMIT = 128
export * from './local-session-protocol-revisions'
export { SESSION_WAGGLE_CONTRACT_VERSION } from './local-session-waggle'

export type LocalSessionClientHello = SchemaType<typeof localSessionClientHelloSchema>
export type LocalSessionCommandPayload = SchemaType<typeof localSessionCommandPayloadSchema>
export type LocalSessionCommandResult = SchemaType<typeof localSessionCommandResultSchema>
export type LocalSessionNegotiationResult = SchemaType<typeof localSessionNegotiationResultSchema>

export type LocalSessionServerFrame =
  | {
      readonly kind: 'response'
      readonly requestId: string
      readonly payload: unknown
    }
  | {
      readonly kind: 'error'
      readonly requestId?: string | undefined
      readonly code: string
      /** What kind of failure it is, which the CLI exits with (ADR 0063). */
      readonly errorKind: SessionHostErrorKind
      readonly message: string
      readonly retryable: boolean
    }
  | {
      readonly kind: 'subscribed'
      readonly requestId: string
      readonly subscriptionId: string
      readonly cursor: SessionHostEventCursor
      readonly activeRuns?: readonly BackgroundRunSnapshot[] | undefined
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
      readonly requestId?: string | undefined
      readonly subscriptionId?: string | undefined
      readonly reason: 'host-restarted' | 'cursor-expired' | 'cursor-ahead' | 'slow-consumer'
      readonly cursor: SessionHostEventCursor
    }
  | {
      readonly kind: 'subscription-closed'
      readonly subscriptionId: string
    }
