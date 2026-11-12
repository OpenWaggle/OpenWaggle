import { Schema } from '@shared/schema'
import type { ContextCompactionResult } from '@shared/types/context-usage'
import { SESSION_WAGGLE_CONTRACT_VERSION } from '@shared/types/local-session-waggle'
import type { SessionHostEventCursor } from '@shared/types/session-host-event'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  type SessionQueryOutcome,
} from '@shared/types/session-query'

/**
 * Responses the Local Session client receives for the command contracts whose response types are
 * declared inline in `LocalSessionCommandResult` (the other contracts have their own schemas).
 */

const LOCAL_UI_EFFECTS = [
  'pinned',
  'unpinned',
  'pin-moved',
  'interrupted-run-dismissed',
  'tree-navigated',
  'branch-renamed',
  'branch-archived',
  'branch-restored',
  'tree-ui-state-updated',
  'session-deleted',
  'follow-up-edit-hold-renewed',
  'follow-up-edit-hold-lost',
] as const

export const localUiResponseSchema = Schema.Struct({
  requestId: Schema.String,
  effect: Schema.Literal(...LOCAL_UI_EFFECTS),
  sessionId: Schema.String,
  navigation: Schema.optional(
    Schema.Struct({
      editorText: Schema.optionalWith(Schema.String, { exact: true }),
      cancelled: Schema.Boolean,
    }),
  ),
  leaseExpiresAt: Schema.optional(Schema.Number),
})

const sessionHostEventCursorSchema: Schema.Schema<SessionHostEventCursor> = Schema.Struct({
  hostInstanceId: Schema.String,
  sequence: Schema.Number,
})

const sessionQueryOutcomeHeaderSchema = Schema.Struct({ operation: Schema.String })

/**
 * The query outcome union is the Host's own read model; the client checks that it names an
 * operation and keeps the rest as the Host wrote it.
 */
const sessionQueryOutcomeSchema = Schema.declare(
  (value: unknown): value is SessionQueryOutcome =>
    Schema.is(sessionQueryOutcomeHeaderSchema)(value),
  { identifier: 'SessionQueryOutcome' },
)

export const sessionQueryResponseSchema = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_QUERY_CONTRACT_VERSION),
  requestId: Schema.String,
  eventCursor: Schema.optional(sessionHostEventCursorSchema),
  outcome: sessionQueryOutcomeSchema,
})

/** A Waggle send's report; a Waggle send is never `queued`. */
const waggleSendReportSchema = Schema.Struct({
  outcome: Schema.Literal('delivered', 'refused', 'cancelled'),
  message: Schema.optionalWith(Schema.String, { exact: true }),
  code: Schema.optionalWith(Schema.String, { exact: true }),
  runId: Schema.optionalWith(Schema.String, { exact: true }),
})

export const sessionWaggleResponseSchema = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_WAGGLE_CONTRACT_VERSION),
  requestId: Schema.String,
  idempotencyKey: Schema.String,
  replayed: Schema.Boolean,
  report: waggleSendReportSchema,
})

export const sessionWaggleCancellationResponseSchema = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_WAGGLE_CONTRACT_VERSION),
  requestId: Schema.String,
  sessionId: Schema.String,
  cancelled: Schema.Boolean,
})

const contextCompactionResultSchema: Schema.Schema<ContextCompactionResult> = Schema.Struct({
  summary: Schema.String,
  firstKeptEntryId: Schema.String,
  tokensBefore: Schema.Number,
})

export const localCompactionResponseSchema = Schema.Struct({
  requestId: Schema.String,
  sessionId: Schema.String,
  result: contextCompactionResultSchema,
})

export const localCompactionCancellationResponseSchema = Schema.Struct({
  requestId: Schema.String,
  sessionId: Schema.String,
  cancelled: Schema.Boolean,
})

/** A command frame's payload: which contract answered, and its still-undecoded response. */
export const localSessionCommandResponsePayloadSchema = Schema.Struct({
  contract: Schema.String,
  response: Schema.Unknown,
})
