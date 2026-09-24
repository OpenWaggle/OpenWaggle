import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { SETTINGS_KEY_PROJECT_PATH_ALIASES, SETTINGS_KEY_SELECTED_MODELS_BY_PROJECT } from './keys'

/** Aliased project paths recorded before canonicalization: alias -> canonical target. Kept in the app DB so removals can resolve identities after the aliased path stops existing. */
/** Per-project selected model refs; kept in the app DB because they must never reach the repo-local project settings file. */
function sanitizeSelectedModelsByProject(raw: unknown) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS.selectedModelsByProject }
  }
  const result: Record<string, string> = {}
  for (const [projectPath, model] of Object.entries(raw)) {
    if (projectPath && typeof model === 'string') result[projectPath] = model
  }
  return result
}

function storedValue(storedSettings: Readonly<Record<string, unknown>>, key: string) {
  return Object.hasOwn(storedSettings, key) ? storedSettings[key] : undefined
}

export function resolveStoredSelectedModels(storedSettings: Readonly<Record<string, unknown>>) {
  return {
    selectedModelsByProject: sanitizeSelectedModelsByProject(
      storedValue(storedSettings, SETTINGS_KEY_SELECTED_MODELS_BY_PROJECT),
    ),
  }
}

export function resolveNextSelectedModels(current: Settings, partial: Partial<Settings>) {
  return {
    selectedModelsByProject:
      partial.selectedModelsByProject !== undefined
        ? sanitizeSelectedModelsByProject(partial.selectedModelsByProject)
        : current.selectedModelsByProject,
  }
}

function sanitizeProjectPathAliases(raw: unknown) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS.projectPathAliases }
  }
  const result: Record<string, string> = {}
  for (const [alias, canonicalPath] of Object.entries(raw)) {
    if (alias && typeof canonicalPath === 'string' && canonicalPath) {
      result[alias] = canonicalPath
    }
  }
  return result
}

export function resolveStoredProjectPathAliases(storedSettings: Readonly<Record<string, unknown>>) {
  return {
    projectPathAliases: sanitizeProjectPathAliases(
      storedValue(storedSettings, SETTINGS_KEY_PROJECT_PATH_ALIASES),
    ),
  }
}

export function resolveNextProjectPathAliases(current: Settings, partial: Partial<Settings>) {
  return {
    projectPathAliases:
      partial.projectPathAliases !== undefined
        ? sanitizeProjectPathAliases(partial.projectPathAliases)
        : current.projectPathAliases,
  }
}
