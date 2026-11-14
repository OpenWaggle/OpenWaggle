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
import { UPDATE_CHANNELS } from '@shared/types/update-channel'
import { desktopNotificationSettingsSchema } from './desktop-notification'
import {
  extensionPanelShortcutBindingsSchema,
  shortcutBindingsSchema,
  shortcutRulesSchema,
} from './settings-shortcuts'
import { sourceControlSettingsFields } from './settings-source-control'
import { automaticWorktreeRemovalSettingsSchema } from './worktree-inventory'

const positiveIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.positive())
const nonNegativeIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())
const stringRecordSchema = Schema.Record({ key: Schema.String, value: Schema.String })
const togglesByProjectSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Record({ key: Schema.String, value: Schema.Boolean }),
})

/** Syntax theme selection for every present and future app appearance variant. */
export const syntaxThemeSelectionsSchema = Schema.Struct({
  light: Schema.String,
  dark: Schema.String,
  'high-contrast-light': Schema.String,
  'high-contrast-dark': Schema.String,
})

/** A Title model as a patch carries it: Automatic, Off, or a provider/model reference. */
export const sessionTitleModelInputSchema = Schema.String.pipe(
  Schema.filter((value) => parseSessionTitleModelSetting(value) !== null, {
    message: () => 'Title model must be automatic, off, or a provider/model reference.',
  }),
)

/**
 * Every persisted setting as a patch or a stored row carries it: the single source of both the
 * update schema (each field optional) and the Settings document (each field required, with model
 * references branded). Model references are plain strings here; the settings service brands them.
 */
export const settingsWireFields = {
  selectedModel: Schema.String,
  favoriteModels: Schema.Array(Schema.String),
  /** User-curated canonical Pi model refs ("provider/modelId") shown in the composer picker. */
  enabledModels: Schema.Array(Schema.String),
  projectPath: Schema.NullOr(Schema.String),
  /** Release channel followed by both desktop and CLI update checks. */
  updateChannel: Schema.Literal(...UPDATE_CHANNELS),
  /** Whether this install sends anonymous Usage statistics and error reports (ADR 0046). */
  usageStatisticsEnabled: Schema.Boolean,
  /** Automatic worktree removal (ADR 0060): off by default, app-wide. */
  automaticWorktreeRemoval: automaticWorktreeRemovalSettingsSchema,
  /** Settings → Notifications (ADR 0062): on by default, app-wide. */
  desktopNotifications: desktopNotificationSettingsSchema,
  /** Whether every Session offers Pi's codemode tool, which runs scripts that call several tools. */
  codemodeEnabled: Schema.Boolean,
  /** When Pi keeps provider prompt caches warm (Pi's `cacheWarming`). */
  cacheWarming: Schema.Literal(...PI_CACHE_WARMING_MODES),
  /** Context-window usage percentage at which Pi automatically compacts. */
  compactionThresholdPercent: Schema.Number.pipe(Schema.int(), Schema.between(1, PERCENT_BASE)),
  /** Title model: Automatic, Off, or the model that generates Session titles. */
  sessionTitleModel: sessionTitleModelInputSchema,
  recentProjects: Schema.Array(Schema.String),
  skillTogglesByProject: togglesByProjectSchema,
  /** Named Agent definitions are enabled by default; false disables that name for one project. */
  agentDefinitionTogglesByProject: togglesByProjectSchema,
  projectDisplayNames: stringRecordSchema,
  /** Per-project selected model refs. Stored in the app DB, never in the repo's project settings file. An empty value is a tombstone: the user explicitly cleared the override. */
  selectedModelsByProject: stringRecordSchema,
  /** Aliased project paths recorded before canonicalization: alias -> canonical target. Lets removals resolve identities after the aliased path stops existing. */
  projectPathAliases: stringRecordSchema,
  /** Default authorization mode applied to new sessions unless a project default overrides it. */
  defaultAuthorizationMode: Schema.Literal(...AGENT_AUTHORIZATION_MODES),
  /** Default Session environment mode applied to new sessions (ADR 0010). */
  defaultSessionEnvironmentMode: Schema.Literal(...SESSION_ENVIRONMENT_MODES),
  /** Syntax theme for diff code text (ADR 0016). */
  diffSyntaxTheme: Schema.Literal(...DIFF_SYNTAX_THEMES),
  /** Syntax theme selection for every present and future app appearance variant. */
  syntaxThemeSelections: syntaxThemeSelectionsSchema,
  /** Diff view layout: unified or split. */
  diffView: Schema.Literal(...DIFF_VIEWS),
  /** Wrap long diff lines instead of scrolling horizontally. */
  diffWrapLines: Schema.Boolean,
  /** Keep the Panel rail on the window's right edge while the Right panel is closed (ADR 0043). */
  rightPanelRailVisibleWhenClosed: Schema.Boolean,
  /** Default maximum number of active direct Worker Runs for one parent Session. */
  sessionHostParentConcurrencyLimit: positiveIntegerSchema,
  /** Optional project-specific parent concurrency limits keyed by canonical project path. */
  sessionHostParentConcurrencyLimitsByProject: Schema.Record({
    key: Schema.String,
    value: positiveIntegerSchema,
  }),
  /**
   * App-global maximum number of active Runs of agents' work: every Run of a Worker or of a root
   * agents created, launched or forked, and an agent's Run in a Session the person made. The
   * person's Runs in Sessions the person made never count toward it, and a Run the person starts
   * is never refused by it.
   */
  sessionHostRunCeiling: positiveIntegerSchema,
  /** How long an idle Session Host remains alive after its final liveness owner disappears. */
  sessionHostIdleGracePeriodMs: nonNegativeIntegerSchema,
  /** Whether OpenWaggle-hosted agents receive launch and spawn operations by default. */
  multiAgentEnabled: Schema.Boolean,
  /** Optional project overrides for model-initiated launch and spawn capability. */
  multiAgentEnabledByProject: Schema.Record({ key: Schema.String, value: Schema.Boolean }),
  /**
   * The Pi continuation choice this person remembered per project (ADR 0051); a project without
   * one asks. Kept in the app's own settings, never in a project's settings file.
   */
  piSessionContinuationByProject: Schema.Record({
    key: Schema.String,
    value: Schema.Literal(...PI_SESSION_CONTINUATION_CHOICES),
  }),
  /** Default destination for http(s) links opened from Session surfaces. */
  browserLinkTarget: Schema.Literal(...BROWSER_LINK_TARGETS),
  /** User-created persistent browser profiles; built-ins are resolved at runtime. */
  browserProfiles: browserProfilesSchema,
  /** Storage profile used when opening a new in-app browser tab. */
  browserDefaultProfileId: browserProfileIdSchema,
  /** Viewport applied before a new browser guest paints. */
  browserDefaultViewport: browserPreviewViewportSchema,
  /** Page zoom applied before a new browser guest paints. */
  browserDefaultZoomFactor: browserPreviewZoomFactorSchema,
  /** Preferred colour scheme applied before a new browser guest paints. */
  browserDefaultAppearance: browserPreviewAppearanceSchema,
  /** Capture rate for user and agent preview recordings. */
  browserRecordingFrameRate: browserPreviewRecordingFrameRateSchema,
  /** Whether an agent-opened preview appears in the floating chat player by default. */
  browserAutoShowFloatingPreview: Schema.Boolean,
  /** Whether Pi sessions receive the collaborative browser tools and instructions. */
  enableAgentBrowserAccess: Schema.Boolean,
  /** User overrides layered above the active Appearance package defaults. */
  appearancePreferences: appearancePreferencesSchema,
  ...sourceControlSettingsFields,
  /** Derived compatibility view for surfaces that display one representative binding. */
  shortcutBindings: shortcutBindingsSchema,
  /** User shortcuts for extension side panels keyed by stable Right panel surface id (ADR 0043). */
  extensionPanelShortcutBindings: extensionPanelShortcutBindingsSchema,
  /** Canonical ordered built-in command rules. Later active rules win. */
  shortcutRules: shortcutRulesSchema,
}
