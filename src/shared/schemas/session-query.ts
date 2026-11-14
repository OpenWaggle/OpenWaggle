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
  branchScope: Schema.optionalWith(sessionExportBranchScopeSchema, { exact: true }),
  branchId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  includeQueueBodies: Schema.optionalWith(Schema.Boolean, { exact: true }),
  afterCreatedOrder: Schema.optionalWith(nonNegativeIntegerSchema, { exact: true }),
  throughCreatedOrder: Schema.optionalWith(nonNegativeIntegerSchema, { exact: true }),
  snapshotStateRevision: Schema.optionalWith(nonNegativeIntegerSchema, { exact: true }),
  snapshotHeadNodeId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  capturedAt: Schema.optionalWith(nonNegativeIntegerSchema, { exact: true }),
  /** Exact immutable manifest returned by the first page. Required for stable continuation pages. */
  snapshotManifest: Schema.optionalWith(
    sessionExportManifestSchema.pipe(Schema.filter(sessionInputJsonWithinLimit)),
    { exact: true },
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
  cursor: Schema.optionalWith(cursor, { exact: true }),
  archived: Schema.optionalWith(Schema.Boolean, { exact: true }),
  interrupted: Schema.optionalWith(Schema.Boolean, { exact: true }),
  unreadTerminalStatus: Schema.optionalWith(Schema.Literal('completed', 'failed'), { exact: true }),
  projectPath: Schema.optionalWith(pathValue, { exact: true }),
  projectPaths: Schema.optionalWith(
    Schema.Array(pathValue).pipe(
      Schema.minItems(1),
      Schema.maxItems(SESSION_QUERY_PROJECT_PATH_FILTER_LIMIT),
    ),
    { exact: true },
  ),
  /** A catalog query's current project: the Sessions of the project this path belongs to. */
  workingPath: Schema.optionalWith(pathValue, { exact: true }),
  /** Only the direct Workers of this Session. */
  parentSessionId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  searchText: Schema.optionalWith(searchText, { exact: true }),
})

export const sessionSearchQuerySchema = Schema.Struct({
  operation: Schema.Literal('search'),
  query: searchText,
  limit: discoveryLimit,
  cursor: Schema.optionalWith(cursor, { exact: true }),
  projectPath: Schema.optionalWith(pathValue, { exact: true }),
  workingPath: Schema.optionalWith(pathValue, { exact: true }),
  includeArchived: Schema.optionalWith(Schema.Boolean, { exact: true }),
  searchScope: Schema.optionalWith(Schema.Literal('discovery', 'full-transcript'), { exact: true }),
  mode: Schema.optionalWith(Schema.Literal('hybrid', 'lexical', 'semantic'), { exact: true }),
  requireFresh: Schema.optionalWith(Schema.Boolean, { exact: true }),
  waitTimeoutMs: Schema.optionalWith(
    Schema.Number.pipe(Schema.int(), Schema.between(0, SESSION_QUERY_MAX_WAIT_MS)),
    { exact: true },
  ),
})

export const sessionTurnsQuerySchema = Schema.Struct({
  operation: Schema.Literal('turns'),
  sessionId: sessionInputIdSchema,
  limit: discoveryLimit,
  cursor: Schema.optionalWith(cursor, { exact: true }),
})

export const sessionItemsQuerySchema = Schema.Struct({
  operation: Schema.Literal('items'),
  sessionId: sessionInputIdSchema,
  limit: transcriptLimit,
  runId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  branchScope: Schema.optionalWith(sessionExportBranchScopeSchema, { exact: true }),
  branchId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  afterCreatedOrder: Schema.optionalWith(nonNegativeIntegerSchema, { exact: true }),
  throughCreatedOrder: Schema.optionalWith(nonNegativeIntegerSchema, { exact: true }),
  snapshotHeadNodeId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
})

export const sessionQueueListQuerySchema = Schema.Struct({
  operation: Schema.Literal('queue-list'),
  sessionId: sessionInputIdSchema,
  includeBodies: Schema.optionalWith(Schema.Boolean, { exact: true }),
})

export const delegationsListQuerySchema = Schema.Struct({
  operation: Schema.Literal('delegations-list'),
  limit: discoveryLimit,
  cursor: Schema.optionalWith(cursor, { exact: true }),
  projectPath: Schema.optionalWith(pathValue, { exact: true }),
  workingPath: Schema.optionalWith(pathValue, { exact: true }),
  parentSessionId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  workerSessionId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  states: Schema.optionalWith(
    Schema.Array(delegationStateSchema).pipe(Schema.maxItems(DELEGATION_STATES.length)),
    { exact: true },
  ),
})

export const delegationsReadQuerySchema = Schema.Struct({
  operation: Schema.Literal('delegations-read'),
  delegationId: sessionInputIdSchema,
  limit: Schema.optionalWith(
    Schema.Number.pipe(Schema.int(), Schema.between(1, SESSION_QUERY_DELEGATION_READ_LIMIT)),
    { exact: true },
  ),
  cursor: Schema.optionalWith(cursor, { exact: true }),
})

export const delegationsConflictsQuerySchema = Schema.Struct({
  operation: Schema.Literal('delegations-conflicts'),
  limit: discoveryLimit,
  cursor: Schema.optionalWith(cursor, { exact: true }),
  projectPath: Schema.optionalWith(pathValue, { exact: true }),
  workingPath: Schema.optionalWith(pathValue, { exact: true }),
  parentSessionId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  workerSessionId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  delegationId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
  kinds: Schema.optionalWith(
    Schema.Array(Schema.Literal(...DELEGATION_CONFLICT_KINDS)).pipe(
      Schema.maxItems(DELEGATION_CONFLICT_KINDS.length),
    ),
    { exact: true },
  ),
  statuses: Schema.optionalWith(
    Schema.Array(Schema.Literal(...DELEGATION_CONFLICT_STATUSES)).pipe(
      Schema.maxItems(DELEGATION_CONFLICT_STATUSES.length),
    ),
    { exact: true },
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
  after: Schema.optionalWith(sessionHostEventCursorSchema, { exact: true }),
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
