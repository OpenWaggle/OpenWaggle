import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { Schema } from '@shared/schema'
import { extensionContributionIdSchema, extensionIdSchema } from './extensions'

const RESOURCE_TEXT_MAX_LENGTH = 512
const RESOURCE_LOCATOR_MAX_LENGTH = 4096
const RESOURCE_CURSOR_MAX_LENGTH = 8192
const RESOURCE_LIST_MAX_LIMIT = 100

const resourceTextSchema = Schema.String.pipe(
  Schema.filter((value) => value.trim() === value && value.length > 0),
  Schema.maxLength(RESOURCE_TEXT_MAX_LENGTH),
)

function isSafeHttpsLocator(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
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
export const extensionSessionResourceRoleSchema = Schema.Literal('source', 'output')
export const extensionSessionResourcePublishPayloadSchema = Schema.Struct({
  key: extensionContributionIdSchema,
  title: resourceTextSchema,
  kind: Schema.Literal('image', 'link'),
  role: extensionSessionResourceRoleSchema,
  locator: Schema.String.pipe(
    Schema.maxLength(RESOURCE_LOCATOR_MAX_LENGTH),
    Schema.filter(isSafeHttpsLocator),
  ),
})

export const extensionSessionResourcesListPayloadSchema = Schema.Struct({
  cursor: Schema.optional(
    Schema.NullOr(Schema.String.pipe(Schema.maxLength(RESOURCE_CURSOR_MAX_LENGTH))),
  ),
  limit: Schema.optional(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(1),
      Schema.lessThanOrEqualTo(RESOURCE_LIST_MAX_LIMIT),
    ),
  ),
})

export const extensionSessionResourceViewSchema = Schema.Struct({
  id: resourceTextSchema,
  title: resourceTextSchema,
  kind: extensionSessionResourceKindSchema,
  mimeType: Schema.NullOr(Schema.String),
  available: Schema.Boolean,
  isSource: Schema.Boolean,
  isOutput: Schema.Boolean,
})

const resultBase = {
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES),
  sessionId: resourceTextSchema,
}

export const extensionSessionResourcesListResultSchema = Schema.Struct({
  ...resultBase,
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES),
  resources: Schema.Array(extensionSessionResourceViewSchema),
  total: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  nextCursor: Schema.NullOr(Schema.String.pipe(Schema.maxLength(RESOURCE_CURSOR_MAX_LENGTH))),
})

export const extensionSessionResourcePublishResultSchema = Schema.Struct({
  ...resultBase,
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE),
  resource: extensionSessionResourceViewSchema,
})
