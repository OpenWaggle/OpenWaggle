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
  text: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(ARCHIVED_ITEMS_MAX_TEXT_LENGTH)), {
    exact: true,
  }),
  project: Schema.optionalWith(
    Schema.Struct({
      projectPath: Schema.NullOr(
        Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_PROJECT_PATH_LENGTH)),
      ),
    }),
    { exact: true },
  ),
  archivedWithin: Schema.optionalWith(Schema.Literal(...ARCHIVED_WITHIN_FILTERS), { exact: true }),
  kind: Schema.optionalWith(Schema.Literal(...ARCHIVED_ITEM_KIND_FILTERS), { exact: true }),
}

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

export const archivedItemsRefsQuerySchema = Schema.Struct({
  ...archivedItemsFilterFields,
  sort: Schema.optionalWith(Schema.Literal(...ARCHIVED_ITEMS_SORTS), { exact: true }),
  limit: Schema.Number.pipe(Schema.int(), Schema.between(1, ARCHIVED_ITEMS_SELECTION_LIMIT)),
})

export const archivedItemsChangeSchema = Schema.Struct({
  archived: Schema.Boolean,
  items: Schema.Array(
    Schema.Struct({
      ref: archivedItemRefSchema,
      archivedAt: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.nonNegative()), {
        exact: true,
      }),
    }),
  ).pipe(Schema.minItems(1), Schema.maxItems(ARCHIVED_ITEMS_SELECTION_LIMIT)),
})

export const archivedSessionIdsSchema = Schema.Array(sessionIdSchema).pipe(
  Schema.minItems(1),
  Schema.maxItems(ARCHIVED_ITEMS_SELECTION_LIMIT),
)
