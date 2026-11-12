import type { SchemaType } from '@shared/schema'
import type { settingsSchema } from '@shared/schemas/settings'
import { DEFAULT_SESSION_TITLE_MODEL } from '../session-title-model'
import { DEFAULT_AGENT_AUTHORIZATION_MODE } from './agent-authorization'
import { DEFAULT_APPEARANCE_PREFERENCES } from './appearance-preferences'
import { SupportedModelId } from './brand'
import {
  DEFAULT_BROWSER_PREVIEW_AUTO_SHOW_FLOATING,
  DEFAULT_BROWSER_PREVIEW_INITIAL_CONTROLS,
  DEFAULT_BROWSER_PREVIEW_RECORDING_FRAME_RATE,
} from './browser-preview-controls'
import { DEFAULT_BROWSER_PROFILE_ID } from './browser-profile'
import { DEFAULT_DESKTOP_NOTIFICATION_SETTINGS } from './desktop-notification'
import { DEFAULT_SHORTCUT_RULES, shortcutBindingsFromRules } from './shortcuts'
import { DEFAULT_SYNTAX_THEME_SELECTIONS } from './syntax'
import { DEFAULT_UPDATE_CHANNEL } from './update-channel'
import { DEFAULT_AUTOMATIC_WORKTREE_REMOVAL } from './worktree-inventory'

export type Provider = string
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/**
 * Pi's built-in default thinking level, used when Pi's settings name none. The thinking level is
 * Session state kept by Pi; a new Session starts from Pi's global default.
 */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium'

/**
 * Diff view layout. "unified" is one column; "split" is side-by-side.
 * Named for the layout: "stacked" was rejected because it reads as a third mode
 * alongside unified and split rather than as a synonym for one of them.
 */
export const DIFF_VIEWS = ['unified', 'split'] as const
export type DiffView = (typeof DIFF_VIEWS)[number]

/**
 * Selectable Syntax themes, bundled with @pierre/diffs. Deliberately outside the
 * Design token contract: these colour language grammar scopes, not semantic roles
 * (ADR 0015 amendment). The colour-blind-safe variants are why the list is curated
 * rather than free-form.
 */
export const DIFF_SYNTAX_THEMES = [
  'pierre-dark',
  'pierre-dark-soft',
  'pierre-dark-vibrant',
  'pierre-dark-protanopia-deuteranopia',
  'pierre-dark-tritanopia',
] as const
export type DiffSyntaxTheme = (typeof DIFF_SYNTAX_THEMES)[number]

export const BROWSER_LINK_TARGETS = ['system', 'app'] as const
export type BrowserLinkTarget = (typeof BROWSER_LINK_TARGETS)[number]

export const DEFAULT_MODEL_REF = SupportedModelId('')
export const DEFAULT_SESSION_HOST_PARENT_CONCURRENCY_LIMIT = 4
export const DEFAULT_SESSION_HOST_RUN_CEILING = 16
export const DEFAULT_SESSION_HOST_IDLE_GRACE_PERIOD_MS = 300_000
export const DEFAULT_COMPACTION_THRESHOLD_PERCENT = 80
/**
 * Automatic compaction runs by this many context tokens at most, whatever the percentage, so a
 * 1M-token window compacts at 400k instead of 800k (ADR 0025, amended). Every request re-reads
 * the whole context, so the tokens past this point were most of the spend.
 */
export const COMPACTION_MAX_THRESHOLD_TOKENS = 400_000

/**
 * Pi's `cacheWarming` setting: keep provider prompt caches warm while a Run works (`streaming`),
 * also between Runs (`idle`), or never (`off`).
 */
export const PI_CACHE_WARMING_MODES = ['off', 'streaming', 'idle'] as const
export type PiCacheWarmingMode = (typeof PI_CACHE_WARMING_MODES)[number]

/** Every setting, as the settings service resolves it: inferred from `settingsSchema`. */
export type Settings = SchemaType<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  selectedModel: DEFAULT_MODEL_REF,
  favoriteModels: [],
  enabledModels: [],
  projectPath: null,
  updateChannel: DEFAULT_UPDATE_CHANNEL,
  usageStatisticsEnabled: true,
  automaticWorktreeRemoval: DEFAULT_AUTOMATIC_WORKTREE_REMOVAL,
  desktopNotifications: DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
  recentProjects: [],
  skillTogglesByProject: {},
  agentDefinitionTogglesByProject: {},
  projectDisplayNames: {},
  selectedModelsByProject: {},
  projectPathAliases: {},
  shortcutRules: DEFAULT_SHORTCUT_RULES,
  shortcutBindings: shortcutBindingsFromRules(DEFAULT_SHORTCUT_RULES),
  extensionPanelShortcutBindings: {},
  defaultSessionEnvironmentMode: 'local',
  defaultAuthorizationMode: DEFAULT_AGENT_AUTHORIZATION_MODE,
  diffSyntaxTheme: 'pierre-dark',
  syntaxThemeSelections: DEFAULT_SYNTAX_THEME_SELECTIONS,
  diffView: 'unified',
  diffWrapLines: false,
  rightPanelRailVisibleWhenClosed: true,
  sessionHostParentConcurrencyLimit: DEFAULT_SESSION_HOST_PARENT_CONCURRENCY_LIMIT,
  sessionHostParentConcurrencyLimitsByProject: {},
  sessionHostRunCeiling: DEFAULT_SESSION_HOST_RUN_CEILING,
  sessionHostIdleGracePeriodMs: DEFAULT_SESSION_HOST_IDLE_GRACE_PERIOD_MS,
  multiAgentEnabled: true,
  multiAgentEnabledByProject: {},
  piSessionContinuationByProject: {},
  browserLinkTarget: 'system',
  browserProfiles: [],
  browserDefaultProfileId: DEFAULT_BROWSER_PROFILE_ID,
  browserDefaultViewport: DEFAULT_BROWSER_PREVIEW_INITIAL_CONTROLS.viewport,
  browserDefaultZoomFactor: DEFAULT_BROWSER_PREVIEW_INITIAL_CONTROLS.zoomFactor,
  browserDefaultAppearance: DEFAULT_BROWSER_PREVIEW_INITIAL_CONTROLS.appearance,
  browserRecordingFrameRate: DEFAULT_BROWSER_PREVIEW_RECORDING_FRAME_RATE,
  browserAutoShowFloatingPreview: DEFAULT_BROWSER_PREVIEW_AUTO_SHOW_FLOATING,
  enableAgentBrowserAccess: true,
  compactionThresholdPercent: DEFAULT_COMPACTION_THRESHOLD_PERCENT,
  codemodeEnabled: true,
  cacheWarming: 'streaming',
  piRuntimeSettingsChosen: { codemodeEnabled: false, cacheWarming: false },
  sessionTitleModel: DEFAULT_SESSION_TITLE_MODEL,
  appearancePreferences: DEFAULT_APPEARANCE_PREFERENCES,
  changeRequestOpenDestination: null,
  changeRequestOpenDestinationByProject: {},
  sourceControlHostProviders: {},
  sourceControlDetectedHostProviders: {},
  sourceControlRepositoryAccounts: {},
  sourceControlChangeRequestRepositories: {},
  sourceControlProjectDeclarations: {},
}
