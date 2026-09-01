import { BASE_TEN, PERCENT_BASE } from '@shared/constants/math'
import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import { SupportedModelId } from '@shared/types/brand'
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git'
import { parseModelRef } from '@shared/types/llm'
import {
  DEFAULT_COMPACTION_THRESHOLD_PERCENT,
  DEFAULT_SETTINGS,
  DIFF_SYNTAX_THEMES,
  DIFF_VIEWS,
  THINKING_LEVELS,
} from '@shared/types/settings'
import {
  DEFAULT_SHORTCUT_BINDINGS,
  isMandatoryShortcutCommand,
  SHORTCUT_COMMANDS,
  type ShortcutBinding,
  type ShortcutBindings,
  type ShortcutCommand,
  shortcutBindingKey,
} from '@shared/types/shortcuts'
import {
  DEFAULT_SYNTAX_THEME_SELECTIONS,
  SYNTAX_APPEARANCE_VARIANTS,
  type SyntaxAppearanceVariant,
  type SyntaxThemeSelections,
} from '@shared/types/syntax'
import { includes } from '@shared/utils/validation'

export function isObjectRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isStringOrNull(value: unknown) {
  return typeof value === 'string' || value === null
}

export function isValidThinkingLevel(value: unknown) {
  return typeof value === 'string' && includes(THINKING_LEVELS, value)
}

export function resolveProjectPath(raw: unknown) {
  return isStringOrNull(raw) ? raw : DEFAULT_SETTINGS.projectPath
}

export function resolveThinkingLevel(raw: unknown) {
  return isValidThinkingLevel(raw) ? raw : DEFAULT_SETTINGS.thinkingLevel
}

export function isValidSessionEnvironmentMode(value: unknown) {
  return typeof value === 'string' && includes(SESSION_ENVIRONMENT_MODES, value)
}

export function resolveDefaultSessionEnvironmentMode(raw: unknown) {
  return isValidSessionEnvironmentMode(raw) ? raw : DEFAULT_SETTINGS.defaultSessionEnvironmentMode
}

export function resolveDefaultAuthorizationMode(raw: unknown) {
  return isAgentAuthorizationMode(raw) ? raw : DEFAULT_SETTINGS.defaultAuthorizationMode
}

export function isValidDiffSyntaxTheme(value: unknown) {
  return typeof value === 'string' && includes(DIFF_SYNTAX_THEMES, value)
}

export function resolveDiffSyntaxTheme(raw: unknown) {
  return isValidDiffSyntaxTheme(raw) ? raw : DEFAULT_SETTINGS.diffSyntaxTheme
}

const MAX_SYNTAX_THEME_ID_LENGTH = 240

function isSyntaxThemeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_SYNTAX_THEME_ID_LENGTH
  )
}

export function resolveSyntaxThemeSelections(raw: unknown): SyntaxThemeSelections {
  if (!isObjectRecord(raw)) return DEFAULT_SYNTAX_THEME_SELECTIONS

  const resolved: Record<SyntaxAppearanceVariant, string> = {
    ...DEFAULT_SYNTAX_THEME_SELECTIONS,
  }
  for (const variant of SYNTAX_APPEARANCE_VARIANTS) {
    const value = raw[variant]
    if (isSyntaxThemeId(value)) resolved[variant] = value.trim()
  }
  return resolved
}

export function isValidDiffView(value: unknown) {
  return typeof value === 'string' && includes(DIFF_VIEWS, value)
}

export function resolveDiffView(raw: unknown) {
  return isValidDiffView(raw) ? raw : DEFAULT_SETTINGS.diffView
}

export function resolveDiffWrapLines(raw: unknown) {
  if (typeof raw === 'boolean') return raw
  // Persisted as a string by the key-value store.
  if (raw === 'true') return true
  if (raw === 'false') return false
  return DEFAULT_SETTINGS.diffWrapLines
}

export function isValidCompactionThresholdPercent(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 1 && value <= PERCENT_BASE
}

export function resolveCompactionThresholdPercent(raw: unknown) {
  return isValidCompactionThresholdPercent(raw) ? raw : DEFAULT_COMPACTION_THRESHOLD_PERCENT
}

export function normalizeStoredModelRef(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  if (parseModelRef(trimmed)) {
    return SupportedModelId(trimmed)
  }

  return null
}

export function sanitizeEnabledModels(models: readonly string[]) {
  const seen = new Set<string>()
  const result: SupportedModelId[] = []
  for (const model of models) {
    const normalized = normalizeStoredModelRef(model)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

export function resolveEnabledModels(raw: unknown) {
  return Array.isArray(raw) && raw.every((value) => typeof value === 'string')
    ? sanitizeEnabledModels(raw)
    : [...DEFAULT_SETTINGS.enabledModels]
}

export function resolveSelectedModel(raw: unknown, enabledModels: readonly SupportedModelId[]) {
  if (typeof raw !== 'string') {
    return DEFAULT_SETTINGS.selectedModel
  }

  const normalizedModel = raw.trim()
  if (!normalizedModel) {
    return DEFAULT_SETTINGS.selectedModel
  }

  if (parseModelRef(normalizedModel)) {
    const model = SupportedModelId(normalizedModel)
    return enabledModels.includes(model) ? model : DEFAULT_SETTINGS.selectedModel
  }

  return DEFAULT_SETTINGS.selectedModel
}

export function sanitizeFavoriteModels(models: readonly string[]) {
  const seen = new Set<string>()
  const result: SupportedModelId[] = []

  for (const model of models) {
    const normalized = normalizeStoredModelRef(model)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= PERCENT_BASE) break
  }

  return result
}

export function resolveFavoriteModels(raw: unknown) {
  return Array.isArray(raw) && raw.every((value) => typeof value === 'string')
    ? sanitizeFavoriteModels(raw)
    : [...DEFAULT_SETTINGS.favoriteModels]
}

export function sanitizeRecentProjects(paths: readonly string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const projectPath of paths) {
    const trimmed = projectPath.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= BASE_TEN) break
  }

  return result
}

export function resolveRecentProjects(raw: unknown) {
  return Array.isArray(raw) && raw.every((value) => typeof value === 'string')
    ? sanitizeRecentProjects(raw)
    : [...DEFAULT_SETTINGS.recentProjects]
}

export function sanitizeSkillTogglesByProject(value: Readonly<Record<string, unknown>>) {
  const sanitized: Record<string, Record<string, boolean>> = {}

  for (const [rawProjectPath, toggles] of Object.entries(value)) {
    const projectPath = rawProjectPath.trim()
    if (!projectPath || !isObjectRecord(toggles)) continue

    const nextToggles: Record<string, boolean> = {}
    for (const [rawSkillId, enabled] of Object.entries(toggles)) {
      const skillId = rawSkillId.trim()
      if (!skillId || typeof enabled !== 'boolean') continue
      nextToggles[skillId] = enabled
    }

    if (Object.keys(nextToggles).length > 0) {
      sanitized[projectPath] = nextToggles
    }
  }

  return sanitized
}

export function resolveSkillTogglesByProject(raw: unknown) {
  return isObjectRecord(raw)
    ? sanitizeSkillTogglesByProject(raw)
    : DEFAULT_SETTINGS.skillTogglesByProject
}

export function sanitizeProjectDisplayNames(raw: unknown) {
  if (!isObjectRecord(raw)) return {}

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key === 'string' && typeof value === 'string') {
      result[key] = value
    }
  }
  return result
}

function sanitizeShortcutBinding(raw: unknown): ShortcutBinding | null {
  if (!isObjectRecord(raw) || typeof raw.key !== 'string') return null
  const key = raw.key.trim()
  if (!key || key.length > BASE_TEN + BASE_TEN) return null

  const optionalBooleanKeys = ['mod', 'ctrl', 'shift', 'alt', 'meta'] as const
  for (const field of optionalBooleanKeys) {
    if (raw[field] !== undefined && typeof raw[field] !== 'boolean') return null
  }

  return {
    key,
    ...(raw.mod === true ? { mod: true } : {}),
    ...(raw.ctrl === true ? { ctrl: true } : {}),
    ...(raw.shift === true ? { shift: true } : {}),
    ...(raw.alt === true ? { alt: true } : {}),
    ...(raw.meta === true ? { meta: true } : {}),
  }
}

export function sanitizeShortcutBindings(raw: unknown): ShortcutBindings {
  if (!isObjectRecord(raw)) return DEFAULT_SHORTCUT_BINDINGS

  const result: Record<ShortcutCommand, ShortcutBinding | null> = {
    ...DEFAULT_SHORTCUT_BINDINGS,
  }
  for (const command of SHORTCUT_COMMANDS) {
    if (raw[command] === null && !isMandatoryShortcutCommand(command)) {
      result[command] = null
      continue
    }
    const binding = sanitizeShortcutBinding(raw[command])
    if (binding) result[command] = binding
  }
  const assigned = Object.values(result).filter(
    (binding): binding is ShortcutBinding => binding !== null,
  )
  if (new Set(assigned.map(shortcutBindingKey)).size !== assigned.length) {
    return DEFAULT_SHORTCUT_BINDINGS
  }
  return result
}
