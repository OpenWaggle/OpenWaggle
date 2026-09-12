import { Schema } from '../schema'

const MAX_ID_LENGTH = 256
const MAX_TITLE_LENGTH = 512
const MAX_URL_LENGTH = 4096
const MAX_CATALOG_CURSOR_LENGTH = 8192
const MAX_CATALOG_PAGE_SIZE = 100
const MAX_TARGET_NODE_IDS = 512

function isTrimmedNonEmpty(value: string) {
  return value.trim() === value && value.length > 0
}

function isSafeOpaqueId(value: string) {
  return isTrimmedNonEmpty(value) && /^[a-z0-9][a-z0-9._:-]*$/iu.test(value)
}

function isSupportedChangeRequestUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    return (
      /\/pull\/\d+\/?$/u.test(url.pathname) || /\/-\/merge_requests\/\d+\/?$/u.test(url.pathname)
    )
  } catch {
    return false
  }
}

export const sessionResourceSessionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(MAX_ID_LENGTH),
  Schema.filter(isSafeOpaqueId),
)

export const sessionResourceIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(MAX_ID_LENGTH),
  Schema.filter(isSafeOpaqueId),
)

export const sessionResourceCatalogViewSchema = Schema.Literal(
  'all',
  'sources',
  'outputs',
  'images',
  'change-requests',
)

export const sessionResourceNodeIdsSchema = Schema.Array(sessionResourceIdSchema).pipe(
  Schema.maxItems(MAX_TARGET_NODE_IDS),
)

export const sessionResourceRouteSelectionSchema = Schema.Struct({
  branchId: Schema.NullOr(sessionResourceIdSchema),
  pathNodeIds: sessionResourceNodeIdsSchema,
})

export const sessionResourceCatalogPageRequestSchema = Schema.Struct({
  view: sessionResourceCatalogViewSchema,
  cursor: Schema.optional(
    Schema.NullOr(Schema.String.pipe(Schema.maxLength(MAX_CATALOG_CURSOR_LENGTH))),
  ),
  limit: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(1),
    Schema.lessThanOrEqualTo(MAX_CATALOG_PAGE_SIZE),
  ),
  selection: Schema.optional(Schema.NullOr(sessionResourceRouteSelectionSchema)),
})

export const sessionResourceKindOrNullSchema = Schema.NullOr(
  Schema.Literal('image', 'file', 'link', 'tool', 'web-search', 'site', 'commit', 'change-request'),
)

export const sessionResourceTargetLimitSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
  Schema.lessThanOrEqualTo(MAX_TARGET_NODE_IDS),
)

export const sessionResourceNodePageRequestSchema = Schema.Struct({
  nodeIds: sessionResourceNodeIdsSchema,
  kind: sessionResourceKindOrNullSchema,
  cursor: Schema.optional(
    Schema.NullOr(Schema.String.pipe(Schema.maxLength(MAX_CATALOG_CURSOR_LENGTH))),
  ),
  limit: sessionResourceTargetLimitSchema,
})

export const recordSessionChangeRequestInputSchema = Schema.Struct({
  title: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(MAX_TITLE_LENGTH),
    Schema.filter(isTrimmedNonEmpty),
  ),
  url: Schema.String.pipe(
    Schema.maxLength(MAX_URL_LENGTH),
    Schema.filter(isSupportedChangeRequestUrl),
  ),
})
