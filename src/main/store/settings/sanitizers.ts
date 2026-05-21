import { BASE_TEN, PERCENT_BASE } from '@shared/constants/math'
import { SupportedModelId } from '@shared/types/brand'
import { parseModelRef } from '@shared/types/llm'
import { DEFAULT_SETTINGS, THINKING_LEVELS } from '@shared/types/settings'
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
