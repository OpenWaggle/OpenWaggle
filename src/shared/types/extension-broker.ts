import type { SchemaType } from '@shared/schema'
import type {
  extensionActionSelectProjectPayloadSchema,
  extensionBranchViewSchema,
  extensionCapabilityAuditEntrySchema,
  extensionInvokeFailureCodeSchema,
  extensionInvokeFailureSchema,
  extensionInvokeInputSchema,
  extensionInvokeDeclaredResultSchema,
  extensionInvokeScopeSchema,
  extensionInvokeSuccessValueSchema,
  extensionModelPreferencesSettingsPatchSchema,
  extensionModelPrefsSchema,
  extensionProjectViewSchema,
  extensionRuntimeRegisterContributionPayloadSchema,
  extensionSessionResourcePublishPayloadSchema,
  extensionSessionViewSchema,
  extensionSettingsGetPayloadSchema,
  extensionSettingsProjectDisplayNameValueSchema,
  extensionSettingsSelectedValueSchema,
  extensionSettingsUpdatePayloadSchema,
  extensionSettingsUpdateSettingPayloadSchema,
  extensionStateReadPayloadSchema,
  extensionStorageDeletePayloadSchema,
  extensionStorageGetPayloadSchema,
  extensionStorageKindSchema,
  extensionStorageListPayloadSchema,
  extensionStorageScopeSchema,
  extensionStorageScopeSelectorSchema,
  extensionStorageSetPayloadSchema,
  extensionSessionResourceViewSchema,
  extensionStateSelectedReadResultSchema,
  extensionSettingsViewSchema,
} from '@shared/schemas/extension-broker'

export type ExtensionInvokeScope = SchemaType<typeof extensionInvokeScopeSchema>
export type ExtensionInvokeInput = SchemaType<typeof extensionInvokeInputSchema>
export type ExtensionInvokeFailureCode = SchemaType<typeof extensionInvokeFailureCodeSchema>
export type ExtensionCapabilityAuditEntry = SchemaType<typeof extensionCapabilityAuditEntrySchema>
export type ExtensionStorageScopeSelector = SchemaType<typeof extensionStorageScopeSelectorSchema>
export type ExtensionStorageKind = SchemaType<typeof extensionStorageKindSchema>
export type ExtensionStorageGetPayload = SchemaType<typeof extensionStorageGetPayloadSchema>
export type ExtensionStorageSetPayload = SchemaType<typeof extensionStorageSetPayloadSchema>
export type ExtensionStorageDeletePayload = SchemaType<typeof extensionStorageDeletePayloadSchema>
export type ExtensionStorageListPayload = SchemaType<typeof extensionStorageListPayloadSchema>
export type ExtensionStorageScope = SchemaType<typeof extensionStorageScopeSchema>
export type ExtensionRuntimeRegisterContributionPayload = SchemaType<
  typeof extensionRuntimeRegisterContributionPayloadSchema
>
export type ExtensionModelPrefs = SchemaType<typeof extensionModelPrefsSchema>
export type ExtensionProjectView = SchemaType<typeof extensionProjectViewSchema>
export type ExtensionSessionView = SchemaType<typeof extensionSessionViewSchema>
export type ExtensionSessionResourcePublishPayload = SchemaType<
  typeof extensionSessionResourcePublishPayloadSchema
>

export type ExtensionSessionResourceView = SchemaType<typeof extensionSessionResourceViewSchema>

export type ExtensionBranchView = SchemaType<typeof extensionBranchViewSchema>
export type ExtensionStateReadPayload = SchemaType<typeof extensionStateReadPayloadSchema>

export type ExtensionStateSelectedReadResult = SchemaType<
  typeof extensionStateSelectedReadResultSchema
>

export type ExtensionActionSelectProjectPayload = SchemaType<
  typeof extensionActionSelectProjectPayloadSchema
>

export type ExtensionSettingsView = SchemaType<typeof extensionSettingsViewSchema>

export type ExtensionModelPreferencesSettingsPatch = SchemaType<
  typeof extensionModelPreferencesSettingsPatchSchema
>
export type ExtensionSettingsGetPayload = SchemaType<typeof extensionSettingsGetPayloadSchema>
export type ExtensionSettingsUpdateSettingPayload = SchemaType<
  typeof extensionSettingsUpdateSettingPayloadSchema
>
export type ExtensionSettingsProjectDisplayNameValue = SchemaType<
  typeof extensionSettingsProjectDisplayNameValueSchema
>
export type ExtensionSettingsSelectedValue = SchemaType<typeof extensionSettingsSelectedValueSchema>
export type ExtensionSettingsUpdatePayload = SchemaType<typeof extensionSettingsUpdatePayloadSchema>
export type ExtensionInvokeSuccessValue = SchemaType<typeof extensionInvokeSuccessValueSchema>
export type ExtensionInvokeFailure = SchemaType<typeof extensionInvokeFailureSchema>
export type ExtensionInvokeResult = SchemaType<typeof extensionInvokeDeclaredResultSchema>
export type { ExtensionDocsDiscoverPayload } from '@shared/schemas/extension-broker-docs'
