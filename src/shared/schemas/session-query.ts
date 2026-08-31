import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import {
  DELEGATION_CONFLICT_KINDS,
  DELEGATION_CONFLICT_STATUSES,
} from '@shared/types/session-delegation-query'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_DISCOVERY_LIMIT,
  SESSION_QUERY_MAX_CURSOR_LENGTH,
  SESSION_QUERY_MAX_PATH_LENGTH,
  SESSION_QUERY_MAX_SEARCH_LENGTH,
  SESSION_QUERY_MAX_WAIT_MS,
  SESSION_QUERY_TRANSCRIPT_LIMIT,
  SESSION_QUERY_WAIT_TARGET_LIMIT,
  type SessionQueryRequest,
} from '@shared/types/session-query'
import {
  exportListQuerySchema,
  exportReadQuerySchema,
  exportWaitQuerySchema,
} from './session-export-operation'

const discoveryLimit = Schema.Number.pipe(
  Schema.int(),
  Schema.between(1, SESSION_QUERY_DISCOVERY_LIMIT),
)
const transcriptLimit = Schema.Number.pipe(
  Schema.int(),
  Schema.between(1, SESSION_QUERY_TRANSCRIPT_LIMIT),
)
const searchText = Schema.String.pipe(Schema.maxLength(SESSION_QUERY_MAX_SEARCH_LENGTH))
const cursor = Schema.String.pipe(Schema.maxLength(SESSION_QUERY_MAX_CURSOR_LENGTH))
const pathValue = Schema.String.pipe(Schema.maxLength(SESSION_QUERY_MAX_PATH_LENGTH))
const delegationStateSchema = Schema.Literal(
  'working',
  'waiting',
  'needs_attention',
  'ready_for_review',
  'revision_requested',
  'accepted',
  'cancelled',
)

const sessionQuerySchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal('list'),
    limit: discoveryLimit,
    cursor: Schema.optional(cursor),
    archived: Schema.optional(Schema.Boolean),
    projectPath: Schema.optional(pathValue),
    workingPath: Schema.optional(pathValue),
  }),
  Schema.Struct({
    operation: Schema.Literal('search'),
    query: searchText,
    limit: discoveryLimit,
    cursor: Schema.optional(cursor),
    projectPath: Schema.optional(pathValue),
    workingPath: Schema.optional(pathValue),
    includeArchived: Schema.optional(Schema.Boolean),
    searchScope: Schema.optional(Schema.Literal('discovery', 'full-transcript')),
    mode: Schema.optional(Schema.Literal('hybrid', 'lexical', 'semantic')),
    requireFresh: Schema.optional(Schema.Boolean),
    waitTimeoutMs: Schema.optional(
      Schema.Number.pipe(Schema.int(), Schema.between(0, SESSION_QUERY_MAX_WAIT_MS)),
    ),
  }),
  Schema.Struct({ operation: Schema.Literal('read'), sessionId: Schema.String }),
  Schema.Struct({
    operation: Schema.Literal('turns'),
    sessionId: Schema.String,
    limit: discoveryLimit,
    cursor: Schema.optional(cursor),
  }),
  Schema.Struct({
    operation: Schema.Literal('items'),
    sessionId: Schema.String,
    limit: transcriptLimit,
    runId: Schema.optional(Schema.String),
    afterCreatedOrder: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
    throughCreatedOrder: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  }),
  Schema.Struct({ operation: Schema.Literal('status'), sessionId: Schema.String }),
  Schema.Struct({ operation: Schema.Literal('requests-list'), sessionId: Schema.String }),
  Schema.Struct({
    operation: Schema.Literal('export'),
    sessionId: Schema.String,
    limit: transcriptLimit,
    branchScope: Schema.optional(Schema.Literal('active-branch', 'tree')),
    branchId: Schema.optional(Schema.String),
    includeQueueBodies: Schema.optional(Schema.Boolean),
    afterCreatedOrder: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
    throughCreatedOrder: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
    snapshotStateRevision: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
    capturedAt: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  }),
  exportListQuerySchema,
  exportReadQuerySchema,
  exportWaitQuerySchema,
  Schema.Struct({
    operation: Schema.Literal('queue-list'),
    sessionId: Schema.String,
    includeBodies: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    operation: Schema.Literal('delegations-list'),
    limit: discoveryLimit,
    cursor: Schema.optional(cursor),
    projectPath: Schema.optional(pathValue),
    workingPath: Schema.optional(pathValue),
    parentSessionId: Schema.optional(Schema.String),
    workerSessionId: Schema.optional(Schema.String),
    states: Schema.optional(Schema.Array(delegationStateSchema)),
  }),
  Schema.Struct({ operation: Schema.Literal('delegations-read'), delegationId: Schema.String }),
  Schema.Struct({
    operation: Schema.Literal('delegations-conflicts'),
    limit: discoveryLimit,
    cursor: Schema.optional(cursor),
    projectPath: Schema.optional(pathValue),
    workingPath: Schema.optional(pathValue),
    parentSessionId: Schema.optional(Schema.String),
    workerSessionId: Schema.optional(Schema.String),
    delegationId: Schema.optional(Schema.String),
    kinds: Schema.optional(Schema.Array(Schema.Literal(...DELEGATION_CONFLICT_KINDS))),
    statuses: Schema.optional(Schema.Array(Schema.Literal(...DELEGATION_CONFLICT_STATUSES))),
  }),
  Schema.Struct({
    operation: Schema.Literal('wait'),
    targets: Schema.Array(
      Schema.Union(
        Schema.Struct({ sessionId: Schema.String, condition: Schema.Literal('idle') }),
        Schema.Struct({ sessionId: Schema.String, condition: Schema.Literal('queue-empty') }),
        Schema.Struct({
          sessionId: Schema.String,
          condition: Schema.Literal('state-revision-after'),
          afterStateRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
        }),
      ),
    ).pipe(Schema.minItems(1), Schema.maxItems(SESSION_QUERY_WAIT_TARGET_LIMIT)),
    timeoutMs: Schema.Number.pipe(Schema.int(), Schema.between(0, SESSION_QUERY_MAX_WAIT_MS)),
    after: Schema.optional(
      Schema.Struct({
        hostInstanceId: Schema.String,
        sequence: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      }),
    ),
  }),
)

export const sessionQueryRequestSchema: Schema.Schema<SessionQueryRequest> = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_QUERY_CONTRACT_VERSION),
  requestId: Schema.String,
  query: sessionQuerySchema,
})

export function decodeSessionQueryRequest(value: unknown) {
  return decodeUnknownExactOrThrow(sessionQueryRequestSchema, value)
}
