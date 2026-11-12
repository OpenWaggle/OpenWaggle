import * as Schema from 'effect/Schema'
import {
  extensionCapabilityAuditEntrySchema,
  extensionInvokeErrorSchema,
  extensionHostContextResultSchema,
} from './broker-schemas-core.js'
import {
  extensionActionSelectProjectResultSchema,
  extensionSettingsGetResultSchema,
  extensionSettingsGetSettingResultSchema,
  extensionSettingsUpdateResultSchema,
  extensionSettingsUpdateSettingResultSchema,
  extensionStateReadResultSchema,
  extensionStateSelectedReadResultSchema,
} from './broker-schemas-openwaggle.js'
import {
  extensionSessionResourcePublishResultSchema,
  extensionSessionResourcesListResultSchema,
} from './broker-schemas-resources.js'
import {
  extensionRuntimeRegisterContributionResultSchema,
  extensionRuntimeUnregisterContributionResultSchema,
  extensionStorageDeleteResultSchema,
  extensionStorageGetResultSchema,
  extensionStorageListResultSchema,
  extensionStorageSetResultSchema,
} from './broker-schemas-storage.js'
import { extensionDocsDiscoverResultSchema, extensionDocsResolveTopicResultSchema } from './docs.js'

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
  extensionSessionResourcesListResultSchema,
  extensionSessionResourcePublishResultSchema,
)

export const extensionInvokeSuccessSchema = Schema.Struct({
  ok: Schema.Literal(true),
  value: extensionInvokeSuccessValueSchema,
  audit: extensionCapabilityAuditEntrySchema,
})

export const extensionInvokeFailureSchema = Schema.Struct({
  ok: Schema.Literal(false),
  error: extensionInvokeErrorSchema,
  audit: Schema.optionalWith(extensionCapabilityAuditEntrySchema, { exact: true }),
})

export const extensionInvokeResultSchema = Schema.Union(
  extensionInvokeSuccessSchema,
  extensionInvokeFailureSchema,
)
