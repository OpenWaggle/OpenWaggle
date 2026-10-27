import { Schema } from '@shared/schema'
import { SessionNodeId } from '@shared/types/brand'
import { sessionInputIdSchema } from './session-input'

/** Most path entries one workspace read may ask for or say it holds. */
export const SESSION_WORKSPACE_MAX_ENTRIES = 100_000
/** Longest tree filter query the Host accepts. */
export const SESSION_TREE_SEARCH_MAX_QUERY_LENGTH = 1_024

const nodeIdSchema = sessionInputIdSchema.pipe(Schema.fromBrand(SessionNodeId))
const revisionSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

export const sessionWorkspaceRequestSchema = Schema.Struct({
  window: Schema.optional(
    Schema.Struct({
      minEntries: Schema.Number.pipe(
        Schema.int(),
        Schema.positive(),
        Schema.lessThanOrEqualTo(SESSION_WORKSPACE_MAX_ENTRIES),
      ),
      includeNodeId: Schema.optional(Schema.NullOr(nodeIdSchema)),
    }),
  ),
  cached: Schema.optional(
    Schema.Struct({
      nodeMutationRevision: revisionSchema,
      nodeIds: Schema.Array(nodeIdSchema).pipe(Schema.maxItems(SESSION_WORKSPACE_MAX_ENTRIES)),
    }),
  ),
})

export const sessionDetailCursorSchema = Schema.Struct({
  nodeMutationRevision: revisionSchema,
  messageCount: revisionSchema,
  lastMessageId: Schema.NullOr(sessionInputIdSchema),
})

export const sessionTreeSearchQuerySchema = Schema.String.pipe(
  Schema.maxLength(SESSION_TREE_SEARCH_MAX_QUERY_LENGTH),
)
