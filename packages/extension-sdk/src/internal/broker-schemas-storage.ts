import * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from '../constants.js'
import { nonEmptyStringSchema } from './broker-schemas-core.js'
import { jsonValueSchema } from './json-schemas.js'
import {
  extensionContributionRegistrationSchema,
  extensionContributionUnregistrationSchema,
} from './manifest-contributions.js'
import {
  extensionContributionFamilySchema,
  extensionContributionIdSchema,
  extensionIdSchema,
} from './manifest-primitives.js'

const extensionStorageKeySchema = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0 || 'Must not be empty.'),
  Schema.filter(
    (value) => value === value.trim() || 'Must not have leading or trailing whitespace.',
  ),
  Schema.maxLength(OPENWAGGLE_EXTENSION.STORAGE.KEY_MAX_LENGTH),
)

export const extensionStorageScopeSelectorSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.STORAGE.SCOPE_KINDS,
)
export const extensionStorageKindSchema = Schema.Literal(...OPENWAGGLE_EXTENSION.STORAGE.KINDS)

export const extensionStorageGetPayloadSchema = Schema.Struct({
  storageKind: extensionStorageKindSchema,
  storageScope: extensionStorageScopeSelectorSchema,
  key: extensionStorageKeySchema,
})

export const extensionStorageSetPayloadSchema = Schema.Struct({
  storageKind: extensionStorageKindSchema,
  storageScope: extensionStorageScopeSelectorSchema,
  key: extensionStorageKeySchema,
  value: jsonValueSchema,
})

export const extensionStorageDeletePayloadSchema = extensionStorageGetPayloadSchema

export const extensionStorageListPayloadSchema = Schema.Struct({
  storageKind: extensionStorageKindSchema,
  storageScope: extensionStorageScopeSelectorSchema,
})

export const extensionStorageGlobalScopeSchema = Schema.Struct({
  kind: Schema.Literal(OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND),
})

export const extensionStorageProjectScopeSchema = Schema.Struct({
  kind: Schema.Literal(OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND),
  projectPath: nonEmptyStringSchema,
})

export const extensionStorageScopeSchema = Schema.Union(
  extensionStorageGlobalScopeSchema,
  extensionStorageProjectScopeSchema,
)

const extensionStorageResultFields = {
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE),
  storageKind: extensionStorageKindSchema,
  storageScope: extensionStorageScopeSchema,
}

export const extensionStorageGetResultSchema = Schema.Struct({
  ...extensionStorageResultFields,
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.GET),
  key: extensionStorageKeySchema,
  value: Schema.NullOr(jsonValueSchema),
})

export const extensionStorageSetResultSchema = Schema.Struct({
  ...extensionStorageResultFields,
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.SET),
  key: extensionStorageKeySchema,
  value: jsonValueSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export const extensionStorageDeleteResultSchema = Schema.Struct({
  ...extensionStorageResultFields,
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE),
  key: extensionStorageKeySchema,
  deleted: Schema.Literal(true),
})

export const extensionStorageListResultSchema = Schema.Struct({
  ...extensionStorageResultFields,
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST),
  keys: Schema.Array(extensionStorageKeySchema),
})

export const extensionRuntimeRegisterContributionPayloadSchema =
  extensionContributionRegistrationSchema
export const extensionRuntimeUnregisterContributionPayloadSchema =
  extensionContributionUnregistrationSchema

const extensionRuntimeContributionResultFields = {
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME),
  family: extensionContributionFamilySchema,
}

export const extensionRuntimeRegisterContributionResultSchema = Schema.Struct({
  ...extensionRuntimeContributionResultFields,
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION),
  registeredContributionId: extensionContributionIdSchema,
})

export const extensionRuntimeUnregisterContributionResultSchema = Schema.Struct({
  ...extensionRuntimeContributionResultFields,
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION),
  unregisteredContributionId: extensionContributionIdSchema,
  unregistered: Schema.Boolean,
})
