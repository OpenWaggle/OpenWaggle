import type {
  extensionActionSelectProjectResultSchema,
  extensionBranchViewSchema,
  extensionModelPreferencesSettingsPatchSchema,
  extensionModelPrefsSchema,
  extensionProjectViewSchema,
  extensionSessionViewSchema,
  extensionSettingsGetResultSchema,
  extensionSettingsGetSettingResultSchema,
  extensionSettingsSelectedValueSchema,
  extensionSettingsUpdatePayloadSchema,
  extensionSettingsUpdateResultSchema,
  extensionSettingsUpdateSettingResultSchema,
  extensionSettingsViewSchema,
  extensionStateCurrentBranchReadResultSchema,
  extensionStateCurrentProjectReadResultSchema,
  extensionStateCurrentSessionReadResultSchema,
  extensionStateModelPreferencesReadResultSchema,
  extensionStateReadResultSchema,
  extensionStateRecentProjectsReadResultSchema,
} from './broker-schemas-openwaggle.js'
import type {
  extensionSessionResourceKindSchema,
  extensionSessionResourcePublishPayloadSchema,
  extensionSessionResourcePublishResultSchema,
  extensionSessionResourceRoleSchema,
  extensionSessionResourcesListPayloadSchema,
  extensionSessionResourcesListResultSchema,
  extensionSessionResourceViewSchema,
} from './broker-schemas-resources.js'
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import type { ExtensionInvokeScope, ExtensionStateSelector } from './core-types.js'
import type { SchemaType } from './schema.js'

export type {
  ExtensionDocsDiscoverPayload,
  ExtensionDocsDiscoverResult,
  ExtensionDocsResolveTopicPayload,
  ExtensionDocsResolveTopicResult,
} from './docs.js'

export type ExtensionModelPrefs = SchemaType<typeof extensionModelPrefsSchema>
export type ExtensionProjectView = SchemaType<typeof extensionProjectViewSchema>
export type ExtensionSessionView = SchemaType<typeof extensionSessionViewSchema>
export type ExtensionBranchView = SchemaType<typeof extensionBranchViewSchema>
export type ExtensionStateReadResult = SchemaType<typeof extensionStateReadResultSchema>
/** The result of reading one state selector; each `ExtensionState*ReadResult` narrows it. */
export interface ExtensionSelectedStateReadResult<TValue> {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE
  readonly scope: ExtensionInvokeScope
  readonly selector: ExtensionStateSelector
  readonly value: TValue
}
export type ExtensionStateCurrentProjectReadResult = SchemaType<
  typeof extensionStateCurrentProjectReadResultSchema
>
export type ExtensionStateCurrentSessionReadResult = SchemaType<
  typeof extensionStateCurrentSessionReadResultSchema
>
export type ExtensionStateCurrentBranchReadResult = SchemaType<
  typeof extensionStateCurrentBranchReadResultSchema
>
export type ExtensionStateRecentProjectsReadResult = SchemaType<
  typeof extensionStateRecentProjectsReadResultSchema
>
export type ExtensionStateModelPreferencesReadResult = SchemaType<
  typeof extensionStateModelPreferencesReadResultSchema
>
export type ExtensionActionSelectProjectResult = SchemaType<
  typeof extensionActionSelectProjectResultSchema
>
export type ExtensionSessionResourceKind = SchemaType<typeof extensionSessionResourceKindSchema>
export type ExtensionSessionResourceRole = SchemaType<typeof extensionSessionResourceRoleSchema>
export type ExtensionSessionResourceView = SchemaType<typeof extensionSessionResourceViewSchema>
export type ExtensionSessionResourcePublishPayload = SchemaType<
  typeof extensionSessionResourcePublishPayloadSchema
>
export type ExtensionSessionResourcesListPayload = SchemaType<
  typeof extensionSessionResourcesListPayloadSchema
>
export type ExtensionSessionResourcesListResult = SchemaType<
  typeof extensionSessionResourcesListResultSchema
>
export type ExtensionSessionResourcePublishResult = SchemaType<
  typeof extensionSessionResourcePublishResultSchema
>
export type ExtensionSettingsView = SchemaType<typeof extensionSettingsViewSchema>
export type ExtensionModelPreferencesSettingsPatch = SchemaType<
  typeof extensionModelPreferencesSettingsPatchSchema
>
export type ExtensionSettingsUpdatePayload = SchemaType<typeof extensionSettingsUpdatePayloadSchema>
export type ExtensionSettingsGetResult = SchemaType<typeof extensionSettingsGetResultSchema>
export type ExtensionSettingsUpdateResult = SchemaType<typeof extensionSettingsUpdateResultSchema>
export type ExtensionSettingsSelectedValue = SchemaType<typeof extensionSettingsSelectedValueSchema>
export type ExtensionSettingsGetSettingResult = SchemaType<
  typeof extensionSettingsGetSettingResultSchema
>
export type ExtensionSettingsUpdateSettingResult = SchemaType<
  typeof extensionSettingsUpdateSettingResultSchema
>
