import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { Schema, type SchemaType } from '@shared/schema'
import { jsonValueSchema } from '@shared/schemas/validation'
import { THINKING_LEVELS } from '@shared/types/settings'
import { extensionContributionIdSchema, extensionIdSchema } from './extensions'

const nonEmptyStringSchema = Schema.String.pipe(Schema.filter((value) => value.trim().length > 0))
const extensionStorageKeySchema = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0 || 'Must not be empty.'),
  Schema.filter(
    (value) => value === value.trim() || 'Must not have leading or trailing whitespace.',
  ),
  Schema.maxLength(OPENWAGGLE_EXTENSION.STORAGE.KEY_MAX_LENGTH),
)

export const extensionInvokeAppScopeSchema = Schema.Struct({
  kind: Schema.Literal('app'),
})

export const extensionInvokeProjectScopeSchema = Schema.Struct({
  kind: Schema.Literal('project'),
  projectPath: nonEmptyStringSchema,
})

export const extensionInvokeSessionScopeSchema = Schema.Struct({
  kind: Schema.Literal('session'),
  projectPath: nonEmptyStringSchema,
  sessionId: nonEmptyStringSchema,
})

export const extensionInvokeBranchScopeSchema = Schema.Struct({
  kind: Schema.Literal('branch'),
  projectPath: nonEmptyStringSchema,
  sessionId: nonEmptyStringSchema,
  branchId: nonEmptyStringSchema,
})

export const extensionInvokeScopeSchema = Schema.Union(
  extensionInvokeAppScopeSchema,
  extensionInvokeProjectScopeSchema,
  extensionInvokeSessionScopeSchema,
  extensionInvokeBranchScopeSchema,
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

export const extensionStorageGetResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.GET),
  storageKind: extensionStorageKindSchema,
  storageScope: extensionStorageScopeSchema,
  key: extensionStorageKeySchema,
  value: Schema.NullOr(jsonValueSchema),
})

export const extensionStorageSetResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.SET),
  storageKind: extensionStorageKindSchema,
  storageScope: extensionStorageScopeSchema,
  key: extensionStorageKeySchema,
  value: jsonValueSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export const extensionStorageDeleteResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE),
  storageKind: extensionStorageKindSchema,
  storageScope: extensionStorageScopeSchema,
  key: extensionStorageKeySchema,
  deleted: Schema.Literal(true),
})

export const extensionStorageListResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST),
  storageKind: extensionStorageKindSchema,
  storageScope: extensionStorageScopeSchema,
  keys: Schema.Array(extensionStorageKeySchema),
})

export const extensionModelPrefsSchema = Schema.Struct({
  selectedModel: Schema.String,
  favoriteModels: Schema.Array(Schema.String),
  enabledModels: Schema.Array(Schema.String),
  thinkingLevel: Schema.Literal(...THINKING_LEVELS),
})

export const extensionProjectViewSchema = Schema.Struct({
  projectPath: nonEmptyStringSchema,
  displayName: Schema.NullOr(Schema.String),
  active: Schema.Boolean,
})

export const extensionSessionViewSchema = Schema.Struct({
  sessionId: nonEmptyStringSchema,
  title: Schema.String,
  projectPath: Schema.NullOr(nonEmptyStringSchema),
})

export const extensionBranchViewSchema = Schema.Struct({
  branchId: nonEmptyStringSchema,
  sessionId: nonEmptyStringSchema,
  name: Schema.String,
  main: Schema.Boolean,
  archived: Schema.Boolean,
})

export const extensionStateReadResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE),
  scope: extensionInvokeScopeSchema,
  activeProjectPath: Schema.NullOr(nonEmptyStringSchema),
  currentProject: Schema.NullOr(extensionProjectViewSchema),
  currentSession: Schema.NullOr(extensionSessionViewSchema),
  currentBranch: Schema.NullOr(extensionBranchViewSchema),
  recentProjects: Schema.Array(nonEmptyStringSchema),
  modelPreferences: extensionModelPrefsSchema,
})

export const extensionActionSelectProjectPayloadSchema = Schema.Struct({
  projectPath: nonEmptyStringSchema,
})

export const extensionActionSelectProjectResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT),
  previousProjectPath: Schema.NullOr(nonEmptyStringSchema),
  projectPath: nonEmptyStringSchema,
  recentProjects: Schema.Array(nonEmptyStringSchema),
})

export const extensionSettingsViewSchema = Schema.Struct({
  modelPreferences: extensionModelPrefsSchema,
  projectDisplayNames: Schema.Record({
    key: Schema.String,
    value: Schema.String,
  }),
})

export const extensionSettingsUpdatePayloadSchema = Schema.Struct({
  selectedModel: Schema.optional(Schema.String),
  favoriteModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  enabledModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  projectDisplayNames: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    ),
  ),
})

export const extensionSettingsGetResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS),
  settings: extensionSettingsViewSchema,
})

export const extensionSettingsUpdateResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS),
  settings: extensionSettingsViewSchema,
})

export const extensionInvokeSuccessValueSchema = Schema.Union(
  extensionHostContextResultSchema,
  extensionStorageGetResultSchema,
  extensionStorageSetResultSchema,
  extensionStorageDeleteResultSchema,
  extensionStorageListResultSchema,
  extensionStateReadResultSchema,
  extensionActionSelectProjectResultSchema,
  extensionSettingsGetResultSchema,
  extensionSettingsUpdateResultSchema,
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

export type ExtensionInvokeScope = SchemaType<typeof extensionInvokeScopeSchema>
export type ExtensionInvokeInput = SchemaType<typeof extensionInvokeInputSchema>
export type ExtensionInvokeFailureCode = SchemaType<typeof extensionInvokeFailureCodeSchema>
export type ExtensionInvokeOutcome = SchemaType<typeof extensionInvokeOutcomeSchema>
export type ExtensionBrokerCapability = SchemaType<typeof extensionBrokerCapabilitySchema>
export type ExtensionBrokerMethod = SchemaType<typeof extensionBrokerMethodSchema>
export type ExtensionCapabilityAuditEntry = SchemaType<typeof extensionCapabilityAuditEntrySchema>
export type ExtensionInvokeError = SchemaType<typeof extensionInvokeErrorSchema>
export type ExtensionHostContextResult = SchemaType<typeof extensionHostContextResultSchema>
export type ExtensionStorageScopeSelector = SchemaType<typeof extensionStorageScopeSelectorSchema>
export type ExtensionStorageKind = SchemaType<typeof extensionStorageKindSchema>
export type ExtensionStorageGetPayload = SchemaType<typeof extensionStorageGetPayloadSchema>
export type ExtensionStorageSetPayload = SchemaType<typeof extensionStorageSetPayloadSchema>
export type ExtensionStorageDeletePayload = SchemaType<typeof extensionStorageDeletePayloadSchema>
export type ExtensionStorageListPayload = SchemaType<typeof extensionStorageListPayloadSchema>
export type ExtensionStorageScope = SchemaType<typeof extensionStorageScopeSchema>
export type ExtensionStorageGetResult = SchemaType<typeof extensionStorageGetResultSchema>
export type ExtensionStorageSetResult = SchemaType<typeof extensionStorageSetResultSchema>
export type ExtensionStorageDeleteResult = SchemaType<typeof extensionStorageDeleteResultSchema>
export type ExtensionStorageListResult = SchemaType<typeof extensionStorageListResultSchema>
export type ExtensionModelPrefs = SchemaType<typeof extensionModelPrefsSchema>
export type ExtensionProjectView = SchemaType<typeof extensionProjectViewSchema>
export type ExtensionSessionView = SchemaType<typeof extensionSessionViewSchema>
export type ExtensionBranchView = SchemaType<typeof extensionBranchViewSchema>
export type ExtensionStateReadResult = SchemaType<typeof extensionStateReadResultSchema>
export type ExtensionActionSelectProjectPayload = SchemaType<
  typeof extensionActionSelectProjectPayloadSchema
>
export type ExtensionActionSelectProjectResult = SchemaType<
  typeof extensionActionSelectProjectResultSchema
>
export type ExtensionSettingsView = SchemaType<typeof extensionSettingsViewSchema>
export type ExtensionSettingsUpdatePayload = SchemaType<typeof extensionSettingsUpdatePayloadSchema>
export type ExtensionSettingsGetResult = SchemaType<typeof extensionSettingsGetResultSchema>
export type ExtensionSettingsUpdateResult = SchemaType<typeof extensionSettingsUpdateResultSchema>
export type ExtensionInvokeSuccessValue = SchemaType<typeof extensionInvokeSuccessValueSchema>
export type ExtensionInvokeSuccess = SchemaType<typeof extensionInvokeSuccessSchema>
export type ExtensionInvokeFailure = SchemaType<typeof extensionInvokeFailureSchema>
export type ExtensionInvokeResult = SchemaType<typeof extensionInvokeResultSchema>
