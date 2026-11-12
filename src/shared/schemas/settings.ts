import { PERCENT_BASE } from '@shared/constants/math'
import { PI_SESSION_CONTINUATION_CHOICES } from '@shared/pi-session-continuation'
import { Schema } from '@shared/schema'
import { appearancePreferencesSchema } from '@shared/schemas/appearance-preferences'
import {
  browserPreviewAppearanceSchema,
  browserPreviewRecordingFrameRateSchema,
  browserPreviewViewportSchema,
  browserPreviewZoomFactorSchema,
} from '@shared/schemas/browser-preview-controls'
import { browserProfileIdSchema, browserProfilesSchema } from '@shared/schemas/browser-profile'
import { parseSessionTitleModelSetting } from '@shared/session-title-model'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git'
import {
  BROWSER_LINK_TARGETS,
  DIFF_SYNTAX_THEMES,
  DIFF_VIEWS,
  PI_CACHE_WARMING_MODES,
} from '@shared/types/settings'
import { SHORTCUT_COMMANDS, SHORTCUT_RULE_LIMITS } from '@shared/types/shortcuts'
import {
  CHANGE_REQUEST_OPEN_DESTINATIONS,
  isSourceControlHostName,
} from '@shared/types/source-control'
import { UPDATE_CHANNELS } from '@shared/types/update-channel'
import { desktopNotificationSettingsSchema } from './desktop-notification'
import {
  extensionPanelShortcutBindingsSchema,
  shortcutBindingSchema,
  shortcutWhenSchema,
} from './settings-shortcuts'
import { automaticWorktreeRemovalSettingsSchema } from './worktree-inventory'

const positiveIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.positive())

/** Upper bounds on the per-host and per-repository source-control maps. */
const SOURCE_CONTROL_SETTINGS_LIMITS = {
  ENTRIES: 500,
  KEY_LENGTH: 512,
} as const

const sourceControlProviderIdSchema = Schema.Literal('github', 'gitlab')
const changeRequestOpenDestinationSchema = Schema.Literal(...CHANGE_REQUEST_OPEN_DESTINATIONS)

/** A lowercase hostname, optionally with a port, as every per-host setting is keyed. */
function isSourceControlHostKey(key: string) {
  return (
    key.length > 0 &&
    key.length <= SOURCE_CONTROL_SETTINGS_LIMITS.KEY_LENGTH &&
    key === key.toLowerCase() &&
    isSourceControlHostName(key)
  )
}

function boundedRecordSchema<V extends Schema.Schema.Any>(
  value: V,
  isValidKey: (key: string) => boolean,
  label: string,
) {
  return Schema.Record({ key: Schema.String, value }).pipe(
    Schema.filter((record) => Object.keys(record).every(isValidKey), {
      message: () => `${label} has an invalid key.`,
    }),
    Schema.filter(
      (record) => Object.keys(record).length <= SOURCE_CONTROL_SETTINGS_LIMITS.ENTRIES,
      { message: () => `${label} has too many entries.` },
    ),
  )
}

function isBoundedKey(key: string) {
  return key.trim().length > 0 && key.length <= SOURCE_CONTROL_SETTINGS_LIMITS.KEY_LENGTH
}

const sourceControlHostProvidersSchema = boundedRecordSchema(
  sourceControlProviderIdSchema,
  isSourceControlHostKey,
  'Source control host providers',
)

const sourceControlProjectDeclarationSchema = Schema.Struct({
  approved: sourceControlHostProvidersSchema,
  declined: sourceControlHostProvidersSchema,
})
const nonNegativeIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

/** Runtime contract shared by IPC patches and persisted settings decoding. */
export const settingsUpdateSchema = Schema.Struct({
  selectedModel: Schema.optionalWith(Schema.String, { exact: true }),
  favoriteModels: Schema.optionalWith(Schema.mutable(Schema.Array(Schema.String)), { exact: true }),
  enabledModels: Schema.optionalWith(Schema.mutable(Schema.Array(Schema.String)), { exact: true }),
  projectPath: Schema.optionalWith(Schema.NullOr(Schema.String), { exact: true }),
  updateChannel: Schema.optionalWith(Schema.Literal(...UPDATE_CHANNELS), { exact: true }),
  usageStatisticsEnabled: Schema.optionalWith(Schema.Boolean, { exact: true }),
  automaticWorktreeRemoval: Schema.optionalWith(automaticWorktreeRemovalSettingsSchema, {
    exact: true,
  }),
  desktopNotifications: Schema.optionalWith(desktopNotificationSettingsSchema, { exact: true }),
  codemodeEnabled: Schema.optionalWith(Schema.Boolean, { exact: true }),
  cacheWarming: Schema.optionalWith(Schema.Literal(...PI_CACHE_WARMING_MODES), { exact: true }),
  compactionThresholdPercent: Schema.optionalWith(
    Schema.Number.pipe(Schema.int(), Schema.between(1, PERCENT_BASE)),
    { exact: true },
  ),
  sessionTitleModel: Schema.optionalWith(
    Schema.String.pipe(
      Schema.filter((value) => parseSessionTitleModelSetting(value) !== null, {
        message: () => 'Title model must be automatic, off, or a provider/model reference.',
      }),
    ),
    { exact: true },
  ),
  recentProjects: Schema.optionalWith(Schema.mutable(Schema.Array(Schema.String)), { exact: true }),
  skillTogglesByProject: Schema.optionalWith(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.mutable(
          Schema.Record({
            key: Schema.String,
            value: Schema.Boolean,
          }),
        ),
      }),
    ),
    { exact: true },
  ),
  agentDefinitionTogglesByProject: Schema.optionalWith(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.Boolean })),
      }),
    ),
    { exact: true },
  ),
  projectDisplayNames: Schema.optionalWith(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    ),
    { exact: true },
  ),
  selectedModelsByProject: Schema.optionalWith(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    ),
    { exact: true },
  ),
  projectPathAliases: Schema.optionalWith(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    ),
    { exact: true },
  ),
  defaultAuthorizationMode: Schema.optionalWith(Schema.Literal(...AGENT_AUTHORIZATION_MODES), {
    exact: true,
  }),
  defaultSessionEnvironmentMode: Schema.optionalWith(Schema.Literal(...SESSION_ENVIRONMENT_MODES), {
    exact: true,
  }),
  diffSyntaxTheme: Schema.optionalWith(Schema.Literal(...DIFF_SYNTAX_THEMES), { exact: true }),
  syntaxThemeSelections: Schema.optionalWith(
    Schema.Struct({
      light: Schema.String,
      dark: Schema.String,
      'high-contrast-light': Schema.String,
      'high-contrast-dark': Schema.String,
    }),
    { exact: true },
  ),
  diffView: Schema.optionalWith(Schema.Literal(...DIFF_VIEWS), { exact: true }),
  diffWrapLines: Schema.optionalWith(Schema.Boolean, { exact: true }),
  rightPanelRailVisibleWhenClosed: Schema.optionalWith(Schema.Boolean, { exact: true }),
  sessionHostParentConcurrencyLimit: Schema.optionalWith(positiveIntegerSchema, { exact: true }),
  sessionHostParentConcurrencyLimitsByProject: Schema.optionalWith(
    Schema.mutable(Schema.Record({ key: Schema.String, value: positiveIntegerSchema })),
    { exact: true },
  ),
  sessionHostRunCeiling: Schema.optionalWith(positiveIntegerSchema, { exact: true }),
  sessionHostIdleGracePeriodMs: Schema.optionalWith(nonNegativeIntegerSchema, { exact: true }),
  multiAgentEnabled: Schema.optionalWith(Schema.Boolean, { exact: true }),
  multiAgentEnabledByProject: Schema.optionalWith(
    Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.Boolean })),
    { exact: true },
  ),
  piSessionContinuationByProject: Schema.optionalWith(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.Literal(...PI_SESSION_CONTINUATION_CHOICES),
      }),
    ),
    { exact: true },
  ),
  browserLinkTarget: Schema.optionalWith(Schema.Literal(...BROWSER_LINK_TARGETS), { exact: true }),
  browserProfiles: Schema.optionalWith(Schema.mutable(browserProfilesSchema), { exact: true }),
  browserDefaultProfileId: Schema.optionalWith(browserProfileIdSchema, { exact: true }),
  browserDefaultViewport: Schema.optionalWith(browserPreviewViewportSchema, { exact: true }),
  browserDefaultZoomFactor: Schema.optionalWith(browserPreviewZoomFactorSchema, { exact: true }),
  browserDefaultAppearance: Schema.optionalWith(browserPreviewAppearanceSchema, { exact: true }),
  browserRecordingFrameRate: Schema.optionalWith(browserPreviewRecordingFrameRateSchema, {
    exact: true,
  }),
  browserAutoShowFloatingPreview: Schema.optionalWith(Schema.Boolean, { exact: true }),
  enableAgentBrowserAccess: Schema.optionalWith(Schema.Boolean, { exact: true }),
  appearancePreferences: Schema.optionalWith(appearancePreferencesSchema, { exact: true }),
  changeRequestOpenDestination: Schema.optionalWith(
    Schema.NullOr(changeRequestOpenDestinationSchema),
    { exact: true },
  ),
  changeRequestOpenDestinationByProject: Schema.optionalWith(
    Schema.mutable(
      boundedRecordSchema(
        changeRequestOpenDestinationSchema,
        isBoundedKey,
        'Change request open destinations',
      ),
    ),
    { exact: true },
  ),
  sourceControlHostProviders: Schema.optionalWith(
    Schema.mutable(
      boundedRecordSchema(
        Schema.Literal('github', 'gitlab', 'unsupported'),
        isSourceControlHostKey,
        'Source control host choices',
      ),
    ),
    { exact: true },
  ),
  sourceControlDetectedHostProviders: Schema.optionalWith(
    Schema.mutable(sourceControlHostProvidersSchema),
    { exact: true },
  ),
  sourceControlRepositoryAccounts: Schema.optionalWith(
    Schema.mutable(
      boundedRecordSchema(
        Schema.String.pipe(
          Schema.minLength(1),
          Schema.maxLength(SOURCE_CONTROL_SETTINGS_LIMITS.KEY_LENGTH),
        ),
        isBoundedKey,
        'Source control repository accounts',
      ),
    ),
    { exact: true },
  ),
  sourceControlChangeRequestRepositories: Schema.optionalWith(
    Schema.mutable(
      boundedRecordSchema(
        Schema.String.pipe(
          Schema.minLength(1),
          Schema.maxLength(SOURCE_CONTROL_SETTINGS_LIMITS.KEY_LENGTH),
        ),
        isBoundedKey,
        'Source control change request repositories',
      ),
    ),
    { exact: true },
  ),
  sourceControlProjectDeclarations: Schema.optionalWith(
    Schema.mutable(
      boundedRecordSchema(
        sourceControlProjectDeclarationSchema,
        isBoundedKey,
        'Source control project declarations',
      ),
    ),
    { exact: true },
  ),
  shortcutBindings: Schema.optionalWith(
    Schema.mutable(
      Schema.Record({
        key: Schema.Literal(...SHORTCUT_COMMANDS),
        value: Schema.Union(shortcutBindingSchema, Schema.Null),
      }),
    ),
    { exact: true },
  ),
  extensionPanelShortcutBindings: Schema.optionalWith(
    Schema.mutable(extensionPanelShortcutBindingsSchema),
    { exact: true },
  ),
  shortcutRules: Schema.optionalWith(
    Schema.mutable(
      Schema.Array(
        Schema.Struct({
          command: Schema.Literal(...SHORTCUT_COMMANDS),
          shortcut: shortcutBindingSchema,
          when: Schema.optionalWith(shortcutWhenSchema, { exact: true }),
        }),
      ).pipe(Schema.maxItems(SHORTCUT_RULE_LIMITS.RULES)),
    ),
    { exact: true },
  ),
})
