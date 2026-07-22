import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { Schema } from '@shared/schema'
import { THINKING_LEVELS } from '@shared/types/settings'
import { extensionInvokeScopeSchema, nonEmptyStringSchema } from './extension-broker-core'
import { extensionContributionIdSchema, extensionIdSchema } from './extensions'

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

export const extensionStateSelectorSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTORS,
)

export const extensionStateReadPayloadSchema = Schema.Struct({
  selector: extensionStateSelectorSchema,
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

function selectedStateResultSchema<TValue>(input: {
  readonly selector: (typeof OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTORS)[number]
  readonly value: Schema.Schema<TValue>
}) {
  return Schema.Struct({
    extensionId: extensionIdSchema,
    contributionId: extensionContributionIdSchema,
    capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE),
    method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE),
    scope: extensionInvokeScopeSchema,
    selector: Schema.Literal(input.selector),
    value: input.value,
  })
}

export const extensionStateCurrentProjectReadResultSchema = selectedStateResultSchema({
  selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_PROJECT,
  value: Schema.NullOr(extensionProjectViewSchema),
})

export const extensionStateCurrentSessionReadResultSchema = selectedStateResultSchema({
  selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_SESSION,
  value: Schema.NullOr(extensionSessionViewSchema),
})

export const extensionStateCurrentBranchReadResultSchema = selectedStateResultSchema({
  selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_BRANCH,
  value: Schema.NullOr(extensionBranchViewSchema),
})

export const extensionStateRecentProjectsReadResultSchema = selectedStateResultSchema({
  selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.RECENT_PROJECTS,
  value: Schema.Array(nonEmptyStringSchema),
})

export const extensionStateModelPreferencesReadResultSchema = selectedStateResultSchema({
  selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.MODEL_PREFERENCES,
  value: extensionModelPrefsSchema,
})

export const extensionStateSelectedReadResultSchema = Schema.Union(
  extensionStateCurrentProjectReadResultSchema,
  extensionStateCurrentSessionReadResultSchema,
  extensionStateCurrentBranchReadResultSchema,
  extensionStateRecentProjectsReadResultSchema,
  extensionStateModelPreferencesReadResultSchema,
)

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
  projectDisplayNames: Schema.Record({ key: Schema.String, value: Schema.String }),
})

export const extensionSettingsKeySchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION_BROKER.SETTING_KEYS,
)

export const extensionModelPreferencesSettingsPatchSchema = Schema.Struct({
  selectedModel: Schema.optional(Schema.String),
  favoriteModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  enabledModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
})

export const extensionSettingsGetModelPreferencesPayloadSchema = Schema.Struct({
  key: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES),
})

export const extensionSettingsGetProjectDisplayNamePayloadSchema = Schema.Struct({
  key: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME),
  projectPath: nonEmptyStringSchema,
})

export const extensionSettingsGetPayloadSchema = Schema.Union(
  extensionSettingsGetModelPreferencesPayloadSchema,
  extensionSettingsGetProjectDisplayNamePayloadSchema,
)

export const extensionSettingsUpdateModelPreferencesPayloadSchema = Schema.Struct({
  key: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES),
  value: extensionModelPreferencesSettingsPatchSchema,
})

export const extensionSettingsUpdateProjectDisplayNamePayloadSchema = Schema.Struct({
  key: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME),
  projectPath: nonEmptyStringSchema,
  value: Schema.NullOr(Schema.String),
})

export const extensionSettingsUpdateSettingPayloadSchema = Schema.Union(
  extensionSettingsUpdateModelPreferencesPayloadSchema,
  extensionSettingsUpdateProjectDisplayNamePayloadSchema,
)

export const extensionSettingsUpdatePayloadSchema = Schema.Struct({
  selectedModel: Schema.optional(Schema.String),
  favoriteModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  enabledModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  projectDisplayNames: Schema.optional(
    Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.String })),
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

export const extensionSettingsModelPreferencesValueSchema = Schema.Struct({
  key: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES),
  value: extensionModelPrefsSchema,
})

export const extensionSettingsProjectDisplayNameValueSchema = Schema.Struct({
  key: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME),
  projectPath: nonEmptyStringSchema,
  value: Schema.NullOr(Schema.String),
})

export const extensionSettingsSelectedValueSchema = Schema.Union(
  extensionSettingsModelPreferencesValueSchema,
  extensionSettingsProjectDisplayNameValueSchema,
)

export const extensionSettingsGetSettingResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING),
  setting: extensionSettingsSelectedValueSchema,
})

export const extensionSettingsUpdateSettingResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING),
  setting: extensionSettingsSelectedValueSchema,
})
