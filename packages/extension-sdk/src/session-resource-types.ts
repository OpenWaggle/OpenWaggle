import * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import {
  extensionContributionIdSchema,
  extensionIdSchema,
  extensionNonEmptyStringSchema,
} from './manifest-primitives.js'
import type { SchemaType } from './schema.js'

const RESOURCE_TITLE_MAX_LENGTH = 512
const RESOURCE_MIME_TYPE_MAX_LENGTH = 255
const RESOURCE_URL_MAX_LENGTH = 4_096
const RESOURCE_LIST_MAX_LIMIT = 200

function isHttpsUrl(value: string) {
  if (value !== value.trim()) return 'Must not have leading or trailing whitespace.'
  if (value.length > RESOURCE_URL_MAX_LENGTH) {
    return `Must be at most ${RESOURCE_URL_MAX_LENGTH} characters.`
  }

  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' && url.username.length === 0 && url.password.length === 0) ||
      'Must be an HTTPS URL without embedded credentials.'
    )
  } catch {
    return 'Must be a valid HTTPS URL.'
  }
}

function isPortableProjectRelativePath(value: string) {
  const trimmed = value.trim()
  if (trimmed.length === 0) return 'Must not be empty.'
  if (value !== trimmed) return 'Must not have leading or trailing whitespace.'
  if (value.length > OPENWAGGLE_EXTENSION.LIMITS.RELATIVE_PATH_MAX_LENGTH) {
    return `Must be at most ${OPENWAGGLE_EXTENSION.LIMITS.RELATIVE_PATH_MAX_LENGTH} characters.`
  }
  if (value.includes(OPENWAGGLE_EXTENSION.PATH.NUL_CHARACTER)) return 'Must not contain NUL bytes.'
  if (
    value.startsWith(OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR) ||
    value.startsWith(OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR) ||
    OPENWAGGLE_EXTENSION.PATTERNS.WINDOWS_ABSOLUTE_PATH.test(value)
  ) {
    return 'Must be relative to the active project root.'
  }

  const segments = value
    .replaceAll(
      OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR,
      OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR,
    )
    .split(OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR)
  return (
    !segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === OPENWAGGLE_EXTENSION.PATH.CURRENT_DIRECTORY_SEGMENT ||
        segment === OPENWAGGLE_EXTENSION.PATH.RELATIVE_PARENT_SEGMENT,
    ) || 'Must not contain empty, "." or ".." path segments.'
  )
}

function isMimeType(value: string) {
  return (
    (value === value.trim() &&
      value.length > 0 &&
      value.length <= RESOURCE_MIME_TYPE_MAX_LENGTH &&
      /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(value)) ||
    'Must be a valid MIME type.'
  )
}

export const extensionSessionResourceKindSchema = Schema.Literal(
  'image',
  'file',
  'link',
  'tool',
  'web-search',
  'site',
  'commit',
  'change-request',
)
export const extensionSessionResourceActivitySchema = Schema.Literal(
  'provided',
  'read',
  'created',
  'updated',
)
export const extensionSessionResourceCategorySchema = Schema.Literal('all', 'sources', 'outputs')
export const extensionSessionResourceReferenceSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('external-url'),
    url: extensionNonEmptyStringSchema.pipe(Schema.filter(isHttpsUrl)),
  }),
  Schema.Struct({
    kind: Schema.Literal('project-file'),
    path: extensionNonEmptyStringSchema.pipe(Schema.filter(isPortableProjectRelativePath)),
  }),
)
export const extensionSessionResourcePublishPayloadSchema = Schema.Struct({
  key: extensionContributionIdSchema,
  kind: extensionSessionResourceKindSchema,
  title: extensionNonEmptyStringSchema.pipe(Schema.maxLength(RESOURCE_TITLE_MAX_LENGTH)),
  activity: extensionSessionResourceActivitySchema,
  mimeType: Schema.optional(extensionNonEmptyStringSchema.pipe(Schema.filter(isMimeType))),
  reference: Schema.optional(extensionSessionResourceReferenceSchema),
  label: Schema.optional(
    extensionNonEmptyStringSchema.pipe(
      Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.DESCRIPTION_MAX_LENGTH),
    ),
  ),
})
export const extensionSessionResourceListPayloadSchema = Schema.Struct({
  category: Schema.optional(extensionSessionResourceCategorySchema),
  limit: Schema.optional(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThan(0),
      Schema.lessThanOrEqualTo(RESOURCE_LIST_MAX_LIMIT),
    ),
  ),
})

export const extensionSessionResourceOccurrenceViewSchema = Schema.Struct({
  actor: Schema.Literal('user', 'agent', 'tool', 'extension'),
  activity: extensionSessionResourceActivitySchema,
  label: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
})
export const extensionSessionResourceViewSchema = Schema.Struct({
  resourceId: extensionContributionIdSchema,
  kind: extensionSessionResourceKindSchema,
  title: Schema.String,
  mimeType: Schema.NullOr(Schema.String),
  available: Schema.Boolean,
  source: Schema.Boolean,
  output: Schema.Boolean,
  occurrences: Schema.Array(extensionSessionResourceOccurrenceViewSchema),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

const extensionSessionResourceResultFields = {
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES),
  sessionId: extensionNonEmptyStringSchema,
}

export const extensionSessionResourcePublishResultSchema = Schema.Struct({
  ...extensionSessionResourceResultFields,
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE),
  resource: extensionSessionResourceViewSchema,
})
export const extensionSessionResourceListResultSchema = Schema.Struct({
  ...extensionSessionResourceResultFields,
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_SESSION_RESOURCES),
  category: extensionSessionResourceCategorySchema,
  total: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  resources: Schema.Array(extensionSessionResourceViewSchema),
})

export type ExtensionSessionResourceKind = SchemaType<typeof extensionSessionResourceKindSchema>
export type ExtensionSessionResourceActivity = SchemaType<
  typeof extensionSessionResourceActivitySchema
>
export type ExtensionSessionResourceCategory = SchemaType<
  typeof extensionSessionResourceCategorySchema
>
export type ExtensionSessionResourceReference = SchemaType<
  typeof extensionSessionResourceReferenceSchema
>
export type ExtensionSessionResourcePublishPayload = SchemaType<
  typeof extensionSessionResourcePublishPayloadSchema
>
export type ExtensionSessionResourceListPayload = SchemaType<
  typeof extensionSessionResourceListPayloadSchema
>
export type ExtensionSessionResourceOccurrenceView = SchemaType<
  typeof extensionSessionResourceOccurrenceViewSchema
>
export type ExtensionSessionResourceView = SchemaType<typeof extensionSessionResourceViewSchema>
export type ExtensionSessionResourcePublishResult = SchemaType<
  typeof extensionSessionResourcePublishResultSchema
>
export type ExtensionSessionResourceListResult = SchemaType<
  typeof extensionSessionResourceListResultSchema
>
