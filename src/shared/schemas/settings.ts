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
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git'
import {
  BROWSER_LINK_TARGETS,
  DIFF_SYNTAX_THEMES,
  DIFF_VIEWS,
  THINKING_LEVELS,
} from '@shared/types/settings'
import { SHORTCUT_COMMANDS, SHORTCUT_RULE_LIMITS } from '@shared/types/shortcuts'
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

const positiveIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.positive())
const nonNegativeIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

/** Runtime contract shared by IPC patches and persisted settings decoding. */
export const settingsUpdateSchema = Schema.Struct({
  selectedModel: Schema.optional(Schema.String),
  favoriteModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  enabledModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  compactionThresholdPercent: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(1, PERCENT_BASE)),
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
  projectDisplayNames: Schema.optional(
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
  shortcutBindings: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.Literal(...SHORTCUT_COMMANDS),
        value: Schema.Union(shortcutBindingSchema, Schema.Null),
      }),
    ),
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
