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

const archivedItemsFilterFields = {
  text: Schema.optional(Schema.String.pipe(Schema.maxLength(ARCHIVED_ITEMS_MAX_TEXT_LENGTH))),
  project: Schema.optional(
    Schema.Struct({
      projectPath: Schema.NullOr(
        Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_PROJECT_PATH_LENGTH)),
      ),
    }),
  ),
  archivedWithin: Schema.optional(Schema.Literal(...ARCHIVED_WITHIN_FILTERS)),
  kind: Schema.optional(Schema.Literal(...ARCHIVED_ITEM_KIND_FILTERS)),
}

/** Offset cursors stay short decimal strings, so nothing else is accepted. */
const archivedItemsCursorSchema = Schema.String.pipe(
  Schema.maxLength(MAX_CURSOR_LENGTH),
  Schema.pattern(/^\d+$/u),
)

export const archivedItemsQuerySchema = Schema.Struct({
  ...archivedItemsFilterFields,
  sort: Schema.optional(Schema.Literal(...ARCHIVED_ITEMS_SORTS)),
  limit: Schema.Number.pipe(Schema.int(), Schema.between(1, ARCHIVED_ITEMS_PAGE_LIMIT)),
  cursor: Schema.optional(archivedItemsCursorSchema),
})

export const archivedItemsRefsQuerySchema = Schema.Struct({
  ...archivedItemsFilterFields,
  sort: Schema.optional(Schema.Literal(...ARCHIVED_ITEMS_SORTS)),
  limit: Schema.Number.pipe(Schema.int(), Schema.between(1, ARCHIVED_ITEMS_SELECTION_LIMIT)),
})

export const archivedItemsChangeSchema = Schema.Struct({
  archived: Schema.Boolean,
  items: Schema.Array(
    Schema.Struct({
      ref: archivedItemRefSchema,
      archivedAt: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
    }),
  ).pipe(Schema.minItems(1), Schema.maxItems(ARCHIVED_ITEMS_SELECTION_LIMIT)),
})

export const archivedSessionIdsSchema = Schema.Array(sessionIdSchema).pipe(
  Schema.minItems(1),
  Schema.maxItems(ARCHIVED_ITEMS_SELECTION_LIMIT),
)
