import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { Schema } from '@shared/schema'
import {
  extensionDocsDiscoverResultSchema,
  extensionDocsResolveTopicResultSchema,
} from '@shared/schemas/extension-broker-docs'
import { jsonValueSchema } from '@shared/schemas/validation'
import { extensionInvokeScopeSchema, nonEmptyStringSchema } from './extension-broker-core'
import {
  extensionActionSelectProjectResultSchema,
  extensionSettingsGetResultSchema,
  extensionSettingsGetSettingResultSchema,
  extensionSettingsUpdateResultSchema,
  extensionSettingsUpdateSettingResultSchema,
  extensionStateReadResultSchema,
  extensionStateSelectedReadResultSchema,
} from './extension-broker-openwaggle'
import {
  extensionContributionFamilySchema,
  extensionContributionIdSchema,
  extensionContributionRegistrationSchema,
  extensionContributionUnregistrationSchema,
  extensionIdSchema,
} from './extensions'

export * from './extension-broker-core'
export * from './extension-broker-openwaggle'

const extensionStorageKeySchema = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0 || 'Must not be empty.'),
  Schema.filter(
    (value) => value === value.trim() || 'Must not have leading or trailing whitespace.',
  ),
  Schema.maxLength(OPENWAGGLE_EXTENSION.STORAGE.KEY_MAX_LENGTH),
)

export const extensionInvokeInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: extensionContributionIdSchema,
  method: extensionContributionIdSchema,
  scope: extensionInvokeScopeSchema,
  payload: Schema.optional(Schema.Unknown),
})

export const extensionInvokeFailureCodeSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODES,
)
export const extensionInvokeOutcomeSchema = Schema.Literal(...OPENWAGGLE_EXTENSION_BROKER.OUTCOMES)
export const extensionBrokerCapabilitySchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION_BROKER.CAPABILITIES,
)
export const extensionBrokerMethodSchema = Schema.Literal(...OPENWAGGLE_EXTENSION_BROKER.METHODS)

export const extensionCapabilityAuditEntrySchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: extensionContributionIdSchema,
  method: extensionContributionIdSchema,
  scope: extensionInvokeScopeSchema,
  outcome: extensionInvokeOutcomeSchema,
  timestamp: Schema.Number,
  failureCode: Schema.optional(extensionInvokeFailureCodeSchema),
})

export const extensionInvokeErrorSchema = Schema.Struct({
  code: extensionInvokeFailureCodeSchema,
  message: nonEmptyStringSchema,
  issues: Schema.optional(Schema.Array(nonEmptyStringSchema)),
})

export const extensionHostContextResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE),
  scope: extensionInvokeScopeSchema,
  declaredScopes: Schema.Array(Schema.Literal(...OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)),
})

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

export const extensionInvokeSuccessValueSchema = Schema.Union(
  extensionHostContextResultSchema,
  extensionStorageGetResultSchema,
  extensionStorageSetResultSchema,
  extensionStorageDeleteResultSchema,
  extensionStorageListResultSchema,
  extensionStateReadResultSchema,
  extensionStateSelectedReadResultSchema,
  extensionActionSelectProjectResultSchema,
  extensionSettingsGetResultSchema,
  extensionSettingsUpdateResultSchema,
  extensionSettingsGetSettingResultSchema,
  extensionSettingsUpdateSettingResultSchema,
  extensionDocsDiscoverResultSchema,
  extensionDocsResolveTopicResultSchema,
  extensionRuntimeRegisterContributionResultSchema,
  extensionRuntimeUnregisterContributionResultSchema,
)

export const extensionInvokeSuccessSchema = Schema.Struct({
  ok: Schema.Literal(true),
  value: extensionInvokeSuccessValueSchema,
  audit: extensionCapabilityAuditEntrySchema,
})

export const extensionInvokeFailureSchema = Schema.Struct({
  ok: Schema.Literal(false),
  error: extensionInvokeErrorSchema,
  audit: Schema.optional(extensionCapabilityAuditEntrySchema),
})

export const extensionInvokeResultSchema = Schema.Union(
  extensionInvokeSuccessSchema,
  extensionInvokeFailureSchema,
)
