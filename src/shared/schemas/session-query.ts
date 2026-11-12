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
} from '@shared/types/session-query'
import {
  exportListQuerySchema,
  exportReadQuerySchema,
  exportWaitQuerySchema,
  sessionExportBranchScopeSchema,
  sessionExportManifestSchema,
} from './session-export-operation'
import { sessionHostEventCursorSchema } from './session-host-event-cursor'
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
const delegationStateSchema = Schema.Literal(...DELEGATION_STATES)
const nonNegativeIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

export const sessionExportQuerySchema = Schema.Struct({
  operation: Schema.Literal('export'),
  sessionId: sessionInputIdSchema,
  limit: transcriptLimit,
  branchScope: Schema.optional(sessionExportBranchScopeSchema),
  branchId: Schema.optional(sessionInputIdSchema),
  includeQueueBodies: Schema.optional(Schema.Boolean),
  afterCreatedOrder: Schema.optional(nonNegativeIntegerSchema),
  throughCreatedOrder: Schema.optional(nonNegativeIntegerSchema),
  snapshotStateRevision: Schema.optional(nonNegativeIntegerSchema),
  snapshotHeadNodeId: Schema.optional(sessionInputIdSchema),
  capturedAt: Schema.optional(nonNegativeIntegerSchema),
  /** Exact immutable manifest returned by the first page. Required for stable continuation pages. */
  snapshotManifest: Schema.optional(
    sessionExportManifestSchema.pipe(Schema.filter(sessionInputJsonWithinLimit)),
  ),
}).pipe(
  Schema.filter(
    (query) =>
      sessionExportBranchSelectionIsValid(query.branchScope, query.branchId) ||
      'A Session branch can be selected only for an active-branch export.',
  ),
)

export const sessionListQuerySchema = Schema.Struct({
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
  /** A catalog query's current project: the Sessions of the project this path belongs to. */
  workingPath: Schema.optional(pathValue),
  /** Only the direct Workers of this Session. */
  parentSessionId: Schema.optional(sessionInputIdSchema),
  searchText: Schema.optional(searchText),
})

export const sessionSearchQuerySchema = Schema.Struct({
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
})

export const sessionTurnsQuerySchema = Schema.Struct({
  operation: Schema.Literal('turns'),
  sessionId: sessionInputIdSchema,
  limit: discoveryLimit,
  cursor: Schema.optional(cursor),
})

export const sessionItemsQuerySchema = Schema.Struct({
  operation: Schema.Literal('items'),
  sessionId: sessionInputIdSchema,
  limit: transcriptLimit,
  runId: Schema.optional(sessionInputIdSchema),
  branchScope: Schema.optional(sessionExportBranchScopeSchema),
  branchId: Schema.optional(sessionInputIdSchema),
  afterCreatedOrder: Schema.optional(nonNegativeIntegerSchema),
  throughCreatedOrder: Schema.optional(nonNegativeIntegerSchema),
  snapshotHeadNodeId: Schema.optional(sessionInputIdSchema),
})

export const sessionQueueListQuerySchema = Schema.Struct({
  operation: Schema.Literal('queue-list'),
  sessionId: sessionInputIdSchema,
  includeBodies: Schema.optional(Schema.Boolean),
})

export const delegationsListQuerySchema = Schema.Struct({
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
})

export const delegationsReadQuerySchema = Schema.Struct({
  operation: Schema.Literal('delegations-read'),
  delegationId: sessionInputIdSchema,
  limit: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(1, SESSION_QUERY_DELEGATION_READ_LIMIT)),
  ),
  cursor: Schema.optional(cursor),
})

export const delegationsConflictsQuerySchema = Schema.Struct({
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
})

export const sessionWaitTargetSchema = Schema.Union(
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
)

export const sessionWaitQuerySchema = Schema.Struct({
  operation: Schema.Literal('wait'),
  targets: Schema.Array(sessionWaitTargetSchema).pipe(
    Schema.minItems(1),
    Schema.maxItems(SESSION_QUERY_WAIT_TARGET_LIMIT),
  ),
  timeoutMs: Schema.Number.pipe(Schema.int(), Schema.between(0, SESSION_QUERY_MAX_WAIT_MS)),
  after: Schema.optional(sessionHostEventCursorSchema),
})

export const sessionQuerySchema = Schema.Union(
  sessionListQuerySchema,
  sessionSearchQuerySchema,
  Schema.Struct({ operation: Schema.Literal('read'), sessionId: sessionInputIdSchema }),
  sessionTurnsQuerySchema,
  sessionItemsQuerySchema,
  Schema.Struct({ operation: Schema.Literal('status'), sessionId: sessionInputIdSchema }),
  Schema.Struct({ operation: Schema.Literal('requests-list'), sessionId: sessionInputIdSchema }),
  sessionExportQuerySchema,
  exportListQuerySchema,
  exportReadQuerySchema,
  exportWaitQuerySchema,
  sessionQueueListQuerySchema,
  delegationsListQuerySchema,
  delegationsReadQuerySchema,
  delegationsConflictsQuerySchema,
  sessionWaitQuerySchema,
)

export const sessionQueryRequestSchema = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_QUERY_CONTRACT_VERSION),
  requestId: sessionInputIdSchema,
  query: sessionQuerySchema,
})

export function decodeSessionQueryRequest(value: unknown) {
  return decodeUnknownExactOrThrow(sessionQueryRequestSchema, value)
}
