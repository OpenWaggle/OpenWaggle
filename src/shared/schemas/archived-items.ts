import { Schema } from '@shared/schema'
import {
  ARCHIVED_ITEM_KIND_FILTERS,
  ARCHIVED_ITEMS_MAX_TEXT_LENGTH,
  ARCHIVED_ITEMS_PAGE_LIMIT,
  ARCHIVED_ITEMS_SELECTION_LIMIT,
  ARCHIVED_ITEMS_SORTS,
  ARCHIVED_WITHIN_FILTERS,
} from '@shared/types/archived-items'
import { SessionBranchId, SessionId } from '@shared/types/brand'
import { sessionInputIdSchema } from './session-input'

const MAX_CURSOR_LENGTH = 32
const MAX_PROJECT_PATH_LENGTH = 4_096

const sessionIdSchema = sessionInputIdSchema.pipe(Schema.fromBrand(SessionId))
const branchIdSchema = sessionInputIdSchema.pipe(Schema.fromBrand(SessionBranchId))

export const archivedItemRefSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('session'), sessionId: sessionIdSchema }),
  Schema.Struct({
    kind: Schema.Literal('branch'),
    sessionId: sessionIdSchema,
    branchId: branchIdSchema,
  }),
)

/** Which project the Project facet keeps: one path, or the sessions that have no project. */
export const archivedItemsProjectFilterSchema = Schema.Struct({
  projectPath: Schema.NullOr(
    Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_PROJECT_PATH_LENGTH)),
  ),
})

const archivedItemsFilterFields = {
  /** Words that must all appear in the title, project, parent session title, or transcript. */
  text: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(ARCHIVED_ITEMS_MAX_TEXT_LENGTH)), {
    exact: true,
  }),
  project: Schema.optionalWith(archivedItemsProjectFilterSchema, { exact: true }),
  archivedWithin: Schema.optionalWith(Schema.Literal(...ARCHIVED_WITHIN_FILTERS), { exact: true }),
  kind: Schema.optionalWith(Schema.Literal(...ARCHIVED_ITEM_KIND_FILTERS), { exact: true }),
}

export const archivedItemsFilterSchema = Schema.Struct(archivedItemsFilterFields)

/** Offset cursors stay short decimal strings, so nothing else is accepted. */
const archivedItemsCursorSchema = Schema.String.pipe(
  Schema.maxLength(MAX_CURSOR_LENGTH),
  Schema.pattern(/^\d+$/u),
)

export const archivedItemsQuerySchema = Schema.Struct({
  ...archivedItemsFilterFields,
  sort: Schema.optionalWith(Schema.Literal(...ARCHIVED_ITEMS_SORTS), { exact: true }),
  limit: Schema.Number.pipe(Schema.int(), Schema.between(1, ARCHIVED_ITEMS_PAGE_LIMIT)),
  cursor: Schema.optionalWith(archivedItemsCursorSchema, { exact: true }),
})

/** Select all: the first `limit` items in the order the list shows them. */
export const archivedItemsRefsQuerySchema = Schema.Struct({
  ...archivedItemsFilterFields,
  sort: Schema.optionalWith(Schema.Literal(...ARCHIVED_ITEMS_SORTS), { exact: true }),
  limit: Schema.Number.pipe(Schema.int(), Schema.between(1, ARCHIVED_ITEMS_SELECTION_LIMIT)),
})

/** One item of a bulk change; Undo passes the Archive time the restore reported. */
export const archivedItemChangeTargetSchema = Schema.Struct({
  ref: archivedItemRefSchema,
  /** When archiving again, the Archive time to put back instead of now. */
  archivedAt: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.nonNegative()), {
    exact: true,
  }),
})

export const archivedItemsChangeSchema = Schema.Struct({
  archived: Schema.Boolean,
  items: Schema.Array(archivedItemChangeTargetSchema).pipe(
    Schema.minItems(1),
    Schema.maxItems(ARCHIVED_ITEMS_SELECTION_LIMIT),
  ),
})

export const archivedSessionIdsSchema = Schema.Array(sessionIdSchema).pipe(
  Schema.minItems(1),
  Schema.maxItems(ARCHIVED_ITEMS_SELECTION_LIMIT),
)
