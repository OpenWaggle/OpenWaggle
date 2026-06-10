import type { SchemaType } from '@shared/schema'
import type {
  extensionActionSelectProjectPayloadSchema,
  extensionActionSelectProjectResultSchema,
  extensionBranchViewSchema,
  extensionBrokerCapabilitySchema,
  extensionBrokerMethodSchema,
  extensionCapabilityAuditEntrySchema,
  extensionHostContextResultSchema,
  extensionInvokeErrorSchema,
  extensionInvokeFailureCodeSchema,
  extensionInvokeFailureSchema,
  extensionInvokeInputSchema,
  extensionInvokeOutcomeSchema,
  extensionInvokeResultSchema,
  extensionInvokeScopeSchema,
  extensionInvokeSuccessSchema,
  extensionInvokeSuccessValueSchema,
  extensionModelPrefsSchema,
  extensionProjectViewSchema,
  extensionSessionViewSchema,
  extensionSettingsGetResultSchema,
  extensionSettingsUpdatePayloadSchema,
  extensionSettingsUpdateResultSchema,
  extensionSettingsViewSchema,
  extensionStateReadResultSchema,
  extensionStorageDeletePayloadSchema,
  extensionStorageDeleteResultSchema,
  extensionStorageGetPayloadSchema,
  extensionStorageGetResultSchema,
  extensionStorageKindSchema,
  extensionStorageListPayloadSchema,
  extensionStorageListResultSchema,
  extensionStorageScopeSchema,
  extensionStorageScopeSelectorSchema,
  extensionStorageSetPayloadSchema,
  extensionStorageSetResultSchema,
} from '@shared/schemas/extension-broker'

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
export type {
  ExtensionDocsDiscoverPayload,
  ExtensionDocsDiscoverResult,
  ExtensionDocsResolveTopicPayload,
  ExtensionDocsResolveTopicResult,
} from '@shared/schemas/extension-broker-docs'
