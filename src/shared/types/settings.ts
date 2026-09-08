import {
  type AgentAuthorizationMode,
  DEFAULT_AGENT_AUTHORIZATION_MODE,
} from './agent-authorization'
import {
  type AppearancePreferences,
  DEFAULT_APPEARANCE_PREFERENCES,
} from './appearance-preferences'
import { SupportedModelId } from './brand'
import {
  type BrowserPreviewAppearance,
  type BrowserPreviewRecordingFrameRate,
  type BrowserPreviewViewport,
  type BrowserPreviewZoomFactor,
  DEFAULT_BROWSER_PREVIEW_AUTO_SHOW_FLOATING,
  DEFAULT_BROWSER_PREVIEW_INITIAL_CONTROLS,
  DEFAULT_BROWSER_PREVIEW_RECORDING_FRAME_RATE,
} from './browser-preview-controls'
import type { BrowserProfile } from './browser-profile'
import { DEFAULT_BROWSER_PROFILE_ID } from './browser-profile'
import type { SessionEnvironmentMode } from './git'
import {
  DEFAULT_SHORTCUT_RULES,
  type ShortcutBindings,
  type ShortcutRules,
  shortcutBindingsFromRules,
} from './shortcuts'
import { DEFAULT_SYNTAX_THEME_SELECTIONS, type SyntaxThemeSelections } from './syntax'

export type Provider = string
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

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
export const DEFAULT_COMPACTION_THRESHOLD_PERCENT = 80

export interface Settings {
  readonly selectedModel: SupportedModelId
  readonly favoriteModels: readonly SupportedModelId[]
  /** User-curated canonical Pi model refs ("provider/modelId") shown in the composer picker. */
  readonly enabledModels: readonly SupportedModelId[]
  readonly projectPath: string | null
  readonly thinkingLevel: ThinkingLevel
  readonly recentProjects: readonly string[]
  readonly skillTogglesByProject: Readonly<Record<string, Readonly<Record<string, boolean>>>>
  readonly projectDisplayNames: Readonly<Record<string, string>>
  /** Canonical ordered built-in command rules. Later active rules win. */
  readonly shortcutRules: ShortcutRules
  /** Derived compatibility view for surfaces that display one representative binding. */
  readonly shortcutBindings: ShortcutBindings
  /** Default Session environment mode applied to new sessions (ADR 0010). */
  readonly defaultSessionEnvironmentMode: SessionEnvironmentMode
  /** Default authorization mode applied to new sessions unless a project default overrides it. */
  readonly defaultAuthorizationMode: AgentAuthorizationMode
  /** Syntax theme for diff code text (ADR 0016). */
  readonly diffSyntaxTheme: DiffSyntaxTheme
  /** Syntax theme selection for every present and future app appearance variant. */
  readonly syntaxThemeSelections: SyntaxThemeSelections
  /** Diff view layout: unified or split. */
  readonly diffView: DiffView
  /** Wrap long diff lines instead of scrolling horizontally. */
  readonly diffWrapLines: boolean
  /** Default destination for http(s) links opened from Session surfaces. */
  readonly browserLinkTarget: BrowserLinkTarget
  /** User-created persistent browser profiles; built-ins are resolved at runtime. */
  readonly browserProfiles: readonly BrowserProfile[]
  /** Storage profile used when opening a new in-app browser tab. */
  readonly browserDefaultProfileId: string
  /** Viewport applied before a new browser guest paints. */
  readonly browserDefaultViewport: BrowserPreviewViewport
  /** Page zoom applied before a new browser guest paints. */
  readonly browserDefaultZoomFactor: BrowserPreviewZoomFactor
  /** Preferred colour scheme applied before a new browser guest paints. */
  readonly browserDefaultAppearance: BrowserPreviewAppearance
  /** Capture rate for user and agent preview recordings. */
  readonly browserRecordingFrameRate: BrowserPreviewRecordingFrameRate
  /** Whether an agent-opened preview appears in the floating chat player by default. */
  readonly browserAutoShowFloatingPreview: boolean
  /** Whether Pi sessions receive the collaborative browser tools and instructions. */
  readonly enableAgentBrowserAccess: boolean
  /** Context-window usage percentage at which Pi automatically compacts. */
  readonly compactionThresholdPercent: number
  /** User overrides layered above the active Appearance package defaults. */
  readonly appearancePreferences: AppearancePreferences
}

export const DEFAULT_SETTINGS: Settings = {
  selectedModel: DEFAULT_MODEL_REF,
  favoriteModels: [],
  enabledModels: [],
  projectPath: null,
  thinkingLevel: 'medium',
  recentProjects: [],
  skillTogglesByProject: {},
  projectDisplayNames: {},
  shortcutRules: DEFAULT_SHORTCUT_RULES,
  shortcutBindings: shortcutBindingsFromRules(DEFAULT_SHORTCUT_RULES),
  defaultSessionEnvironmentMode: 'local',
  defaultAuthorizationMode: DEFAULT_AGENT_AUTHORIZATION_MODE,
  diffSyntaxTheme: 'pierre-dark',
  syntaxThemeSelections: DEFAULT_SYNTAX_THEME_SELECTIONS,
  diffView: 'unified',
  diffWrapLines: false,
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
  appearancePreferences: DEFAULT_APPEARANCE_PREFERENCES,
}
