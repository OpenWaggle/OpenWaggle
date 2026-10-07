import { PERCENT_BASE } from '@shared/constants/math'
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
import { isExtensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import { BROWSER_LINK_TARGETS, DIFF_SYNTAX_THEMES, DIFF_VIEWS } from '@shared/types/settings'
import {
  EXTENSION_PANEL_SHORTCUT_LIMITS,
  SHORTCUT_COMMANDS,
  SHORTCUT_RULE_LIMITS,
} from '@shared/types/shortcuts'
import {
  CHANGE_REQUEST_OPEN_DESTINATIONS,
  isSourceControlHostName,
} from '@shared/types/source-control'
import { UPDATE_CHANNELS } from '@shared/types/update-channel'
import { parseProjectActionWhenExpression } from '@shared/utils/project-action-shortcuts'

const shortcutBindingSchema = Schema.Struct({
  key: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(SHORTCUT_RULE_LIMITS.KEY_LENGTH),
    Schema.filter((key) => key.trim().length > 0),
  ),
  mod: Schema.optional(Schema.Boolean),
  ctrl: Schema.optional(Schema.Boolean),
  shift: Schema.optional(Schema.Boolean),
  alt: Schema.optional(Schema.Boolean),
  meta: Schema.optional(Schema.Boolean),
})

const shortcutWhenSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(SHORTCUT_RULE_LIMITS.WHEN_LENGTH),
  Schema.filter((when) => parseProjectActionWhenExpression(when.trim()) !== null),
)

/**
 * Keys are checked by the record filter rather than a key refinement: Effect drops keys that fail
 * an index-signature refinement, which would silently discard a saved binding instead of failing.
 */
const extensionPanelShortcutBindingsSchema = Schema.Record({
  key: Schema.String,
  value: shortcutBindingSchema,
}).pipe(
  Schema.filter((bindings) => Object.keys(bindings).every(isExtensionRightPanelSurfaceId), {
    message: () => 'Extension panel shortcuts must be keyed by an extension panel surface id.',
  }),
  Schema.filter(
    (bindings) => Object.keys(bindings).length <= EXTENSION_PANEL_SHORTCUT_LIMITS.BINDINGS,
    {
      message: () =>
        `At most ${String(EXTENSION_PANEL_SHORTCUT_LIMITS.BINDINGS)} extension panel shortcuts are allowed.`,
    },
  ),
)

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
  selectedModel: Schema.optional(Schema.String),
  favoriteModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  enabledModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  updateChannel: Schema.optional(Schema.Literal(...UPDATE_CHANNELS)),
  usageStatisticsEnabled: Schema.optional(Schema.Boolean),
  compactionThresholdPercent: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(1, PERCENT_BASE)),
  ),
  sessionTitleModel: Schema.optional(
    Schema.String.pipe(
      Schema.filter((value) => parseSessionTitleModelSetting(value) !== null, {
        message: () => 'Title model must be automatic, off, or a provider/model reference.',
      }),
    ),
  ),
  recentProjects: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  skillTogglesByProject: Schema.optional(
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
  ),
  agentDefinitionTogglesByProject: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.Boolean })),
      }),
    ),
  ),
  projectDisplayNames: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    ),
  ),
  selectedModelsByProject: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    ),
  ),
  projectPathAliases: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    ),
  ),
  defaultAuthorizationMode: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  defaultSessionEnvironmentMode: Schema.optional(Schema.Literal(...SESSION_ENVIRONMENT_MODES)),
  diffSyntaxTheme: Schema.optional(Schema.Literal(...DIFF_SYNTAX_THEMES)),
  syntaxThemeSelections: Schema.optional(
    Schema.Struct({
      light: Schema.String,
      dark: Schema.String,
      'high-contrast-light': Schema.String,
      'high-contrast-dark': Schema.String,
    }),
  ),
  diffView: Schema.optional(Schema.Literal(...DIFF_VIEWS)),
  diffWrapLines: Schema.optional(Schema.Boolean),
  rightPanelRailVisibleWhenClosed: Schema.optional(Schema.Boolean),
  sessionHostParentConcurrencyLimit: Schema.optional(positiveIntegerSchema),
  sessionHostParentConcurrencyLimitsByProject: Schema.optional(
    Schema.mutable(Schema.Record({ key: Schema.String, value: positiveIntegerSchema })),
  ),
  sessionHostRunCeiling: Schema.optional(positiveIntegerSchema),
  sessionHostIdleGracePeriodMs: Schema.optional(nonNegativeIntegerSchema),
  multiAgentEnabled: Schema.optional(Schema.Boolean),
  multiAgentEnabledByProject: Schema.optional(
    Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.Boolean })),
  ),
  browserLinkTarget: Schema.optional(Schema.Literal(...BROWSER_LINK_TARGETS)),
  browserProfiles: Schema.optional(Schema.mutable(browserProfilesSchema)),
  browserDefaultProfileId: Schema.optional(browserProfileIdSchema),
  browserDefaultViewport: Schema.optional(browserPreviewViewportSchema),
  browserDefaultZoomFactor: Schema.optional(browserPreviewZoomFactorSchema),
  browserDefaultAppearance: Schema.optional(browserPreviewAppearanceSchema),
  browserRecordingFrameRate: Schema.optional(browserPreviewRecordingFrameRateSchema),
  browserAutoShowFloatingPreview: Schema.optional(Schema.Boolean),
  enableAgentBrowserAccess: Schema.optional(Schema.Boolean),
  appearancePreferences: Schema.optional(appearancePreferencesSchema),
  changeRequestOpenDestination: Schema.optional(Schema.NullOr(changeRequestOpenDestinationSchema)),
  changeRequestOpenDestinationByProject: Schema.optional(
    Schema.mutable(
      boundedRecordSchema(
        changeRequestOpenDestinationSchema,
        isBoundedKey,
        'Change request open destinations',
      ),
    ),
  ),
  sourceControlHostProviders: Schema.optional(
    Schema.mutable(
      boundedRecordSchema(
        Schema.Literal('github', 'gitlab', 'unsupported'),
        isSourceControlHostKey,
        'Source control host choices',
      ),
    ),
  ),
  sourceControlDetectedHostProviders: Schema.optional(
    Schema.mutable(sourceControlHostProvidersSchema),
  ),
  sourceControlRepositoryAccounts: Schema.optional(
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
  ),
  sourceControlChangeRequestRepositories: Schema.optional(
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
  ),
  sourceControlProjectDeclarations: Schema.optional(
    Schema.mutable(
      boundedRecordSchema(
        sourceControlProjectDeclarationSchema,
        isBoundedKey,
        'Source control project declarations',
      ),
    ),
  ),
  shortcutBindings: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.Literal(...SHORTCUT_COMMANDS),
        value: Schema.Union(shortcutBindingSchema, Schema.Null),
      }),
    ),
  ),
  extensionPanelShortcutBindings: Schema.optional(
    Schema.mutable(extensionPanelShortcutBindingsSchema),
  ),
  shortcutRules: Schema.optional(
    Schema.mutable(
      Schema.Array(
        Schema.Struct({
          command: Schema.Literal(...SHORTCUT_COMMANDS),
          shortcut: shortcutBindingSchema,
          when: Schema.optional(shortcutWhenSchema),
        }),
      ).pipe(Schema.maxItems(SHORTCUT_RULE_LIMITS.RULES)),
    ),
  ),
})
