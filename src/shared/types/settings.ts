import { SupportedModelId } from './brand'
import type { SessionEnvironmentMode } from './git'
import { DEFAULT_SHORTCUT_BINDINGS, type ShortcutBindings } from './shortcuts'

export type Provider = string
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
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

export const DEFAULT_MODEL_REF = SupportedModelId('')

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
  readonly shortcutBindings: ShortcutBindings
  /** Default Session environment mode applied to new sessions (ADR 0010). */
  readonly defaultSessionEnvironmentMode: SessionEnvironmentMode
  /** Syntax theme for diff code text (ADR 0016). */
  readonly diffSyntaxTheme: DiffSyntaxTheme
  /** Diff view layout: unified or split. */
  readonly diffView: DiffView
  /** Wrap long diff lines instead of scrolling horizontally. */
  readonly diffWrapLines: boolean
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
  shortcutBindings: DEFAULT_SHORTCUT_BINDINGS,
  defaultSessionEnvironmentMode: 'local',
  diffSyntaxTheme: 'pierre-dark',
  diffView: 'unified',
  diffWrapLines: false,
}
