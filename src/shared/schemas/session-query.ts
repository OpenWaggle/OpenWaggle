import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { sessionExportBranchSelectionIsValid } from '@shared/session-export-selection'
import { DELEGATION_STATES } from '@shared/types/session-collaboration'
import {
  DELEGATION_CONFLICT_KINDS,
  DELEGATION_CONFLICT_STATUSES,
} from '@shared/types/session-delegation-query'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_DELEGATION_READ_LIMIT,
  SESSION_QUERY_DISCOVERY_LIMIT,
  SESSION_QUERY_MAX_CURSOR_LENGTH,
  SESSION_QUERY_MAX_PATH_LENGTH,
  SESSION_QUERY_MAX_SEARCH_LENGTH,
  SESSION_QUERY_MAX_WAIT_MS,
  SESSION_QUERY_PROJECT_PATH_FILTER_LIMIT,
  SESSION_QUERY_TRANSCRIPT_LIMIT,
  SESSION_QUERY_WAIT_TARGET_LIMIT,
  type SessionQueryRequest,
} from '@shared/types/session-query'
import {
  exportListQuerySchema,
  exportReadQuerySchema,
  exportWaitQuerySchema,
  sessionExportManifestSchema,
} from './session-export-operation'
import { sessionInputIdSchema, sessionInputJsonWithinLimit } from './session-input'

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

const sessionExportQuerySchema = Schema.Struct({
  operation: Schema.Literal('export'),
  sessionId: sessionInputIdSchema,
  limit: transcriptLimit,
  branchScope: Schema.optional(Schema.Literal('active-branch', 'tree')),
  branchId: Schema.optional(sessionInputIdSchema),
  includeQueueBodies: Schema.optional(Schema.Boolean),
  afterCreatedOrder: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  throughCreatedOrder: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  snapshotStateRevision: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  snapshotHeadNodeId: Schema.optional(sessionInputIdSchema),
  capturedAt: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  snapshotManifest: Schema.optional(
    sessionExportManifestSchema.pipe(Schema.filter(sessionInputJsonWithinLimit)),
  ),
}).pipe(
  Schema.filter(
    (query) =>
      sessionExportBranchSelectionIsValid(query) ||
      'A Session branch can be selected only for an active-branch export.',
  ),
)

const sessionQuerySchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal('list'),
    limit: discoveryLimit,
    cursor: Schema.optional(cursor),
    archived: Schema.optional(Schema.Boolean),
    interrupted: Schema.optional(Schema.Boolean),
    unreadTerminalStatus: Schema.optional(Schema.Literal('completed', 'failed')),
    projectPath: Schema.optional(pathValue),
    projectPaths: Schema.optional(
      Schema.Array(pathValue).pipe(
        Schema.minItems(1),
        Schema.maxItems(SESSION_QUERY_PROJECT_PATH_FILTER_LIMIT),
      ),
    ),
    workingPath: Schema.optional(pathValue),
    searchText: Schema.optional(searchText),
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
  Schema.Struct({ operation: Schema.Literal('read'), sessionId: sessionInputIdSchema }),
  Schema.Struct({
    operation: Schema.Literal('turns'),
    sessionId: sessionInputIdSchema,
    limit: discoveryLimit,
    cursor: Schema.optional(cursor),
  }),
  Schema.Struct({
    operation: Schema.Literal('items'),
    sessionId: sessionInputIdSchema,
    limit: transcriptLimit,
    runId: Schema.optional(sessionInputIdSchema),
    branchScope: Schema.optional(Schema.Literal('active-branch', 'tree')),
    branchId: Schema.optional(sessionInputIdSchema),
    afterCreatedOrder: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
    throughCreatedOrder: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
    snapshotHeadNodeId: Schema.optional(sessionInputIdSchema),
  }),
  Schema.Struct({ operation: Schema.Literal('status'), sessionId: sessionInputIdSchema }),
  Schema.Struct({ operation: Schema.Literal('requests-list'), sessionId: sessionInputIdSchema }),
  sessionExportQuerySchema,
  exportListQuerySchema,
  exportReadQuerySchema,
  exportWaitQuerySchema,
  Schema.Struct({
    operation: Schema.Literal('queue-list'),
    sessionId: sessionInputIdSchema,
    includeBodies: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    operation: Schema.Literal('delegations-list'),
    limit: discoveryLimit,
    cursor: Schema.optional(cursor),
    projectPath: Schema.optional(pathValue),
    workingPath: Schema.optional(pathValue),
    parentSessionId: Schema.optional(sessionInputIdSchema),
    workerSessionId: Schema.optional(sessionInputIdSchema),
    states: Schema.optional(
      Schema.Array(delegationStateSchema).pipe(Schema.maxItems(DELEGATION_STATES.length)),
    ),
  }),
  Schema.Struct({
    operation: Schema.Literal('delegations-read'),
    delegationId: sessionInputIdSchema,
    limit: Schema.optional(
      Schema.Number.pipe(Schema.int(), Schema.between(1, SESSION_QUERY_DELEGATION_READ_LIMIT)),
    ),
    cursor: Schema.optional(cursor),
  }),
  Schema.Struct({
    operation: Schema.Literal('delegations-conflicts'),
    limit: discoveryLimit,
    cursor: Schema.optional(cursor),
    projectPath: Schema.optional(pathValue),
    workingPath: Schema.optional(pathValue),
    parentSessionId: Schema.optional(sessionInputIdSchema),
    workerSessionId: Schema.optional(sessionInputIdSchema),
    delegationId: Schema.optional(sessionInputIdSchema),
    kinds: Schema.optional(
      Schema.Array(Schema.Literal(...DELEGATION_CONFLICT_KINDS)).pipe(
        Schema.maxItems(DELEGATION_CONFLICT_KINDS.length),
      ),
    ),
    statuses: Schema.optional(
      Schema.Array(Schema.Literal(...DELEGATION_CONFLICT_STATUSES)).pipe(
        Schema.maxItems(DELEGATION_CONFLICT_STATUSES.length),
      ),
    ),
  }),
  Schema.Struct({
    operation: Schema.Literal('wait'),
    targets: Schema.Array(
      Schema.Union(
        Schema.Struct({ sessionId: sessionInputIdSchema, condition: Schema.Literal('idle') }),
        Schema.Struct({
          sessionId: sessionInputIdSchema,
          condition: Schema.Literal('queue-empty'),
        }),
        Schema.Struct({
          sessionId: sessionInputIdSchema,
          condition: Schema.Literal('state-revision-after'),
          afterStateRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
        }),
        Schema.Struct({
          sessionId: sessionInputIdSchema,
          condition: Schema.Literal('report-delivered'),
          reportId: sessionInputIdSchema,
        }),
        Schema.Struct({
          sessionId: sessionInputIdSchema,
          condition: Schema.Literal('correlated-reply'),
          correlationId: sessionInputIdSchema,
        }),
      ),
    ).pipe(Schema.minItems(1), Schema.maxItems(SESSION_QUERY_WAIT_TARGET_LIMIT)),
    timeoutMs: Schema.Number.pipe(Schema.int(), Schema.between(0, SESSION_QUERY_MAX_WAIT_MS)),
    after: Schema.optional(
      Schema.Struct({
        hostInstanceId: sessionInputIdSchema,
        sequence: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      }),
    ),
  }),
)

export const sessionQueryRequestSchema: Schema.Schema<SessionQueryRequest> = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_QUERY_CONTRACT_VERSION),
  requestId: sessionInputIdSchema,
  query: sessionQuerySchema,
})

export function decodeSessionQueryRequest(value: unknown) {
  return decodeUnknownExactOrThrow(sessionQueryRequestSchema, value)
}
