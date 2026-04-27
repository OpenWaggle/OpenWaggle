import * as SqlClient from '@effect/sql/SqlClient'
import { BASE_TEN, PERCENT_BASE } from '@shared/constants/math'
import { SupportedModelId } from '@shared/types/brand'
import { parseModelRef } from '@shared/types/llm'
import {
  DEFAULT_SETTINGS,
  type Settings,
  THINKING_LEVELS,
  type ThinkingLevel,
} from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { runAppEffect } from '../runtime'

const logger = createLogger('settings')

const SETTINGS_KEY_DEFAULT_MODEL = 'selectedModel'
const SETTINGS_KEY_FAVORITE_MODELS = 'favoriteModels'
const SETTINGS_KEY_PROJECT_PATH = 'projectPath'
const SETTINGS_KEY_THINKING_LEVEL = 'thinkingLevel'
const SETTINGS_KEY_RECENT_PROJECTS = 'recentProjects'
const SETTINGS_KEY_SKILL_TOGGLES_BY_PROJECT = 'skillTogglesByProject'
const SETTINGS_KEY_ENABLED_MODELS = 'enabledModels'
const SETTINGS_KEY_PROJECT_DISPLAY_NAMES = 'projectDisplayNames'

interface SettingsStoreRow {
  readonly key: string
  readonly value_json: string
}

let settingsCache = createDefaultSettingsSnapshot()
let initializationPromise: Promise<void> | null = null
let writeQueue: Promise<void> = Promise.resolve()

function createDefaultSettingsSnapshot(): Settings {
  return {
    ...DEFAULT_SETTINGS,
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseJsonUnknown(raw: string): unknown {
  return JSON.parse(raw)
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function listStoredSettings(): Promise<Record<string, unknown>> {
  const rows = await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<SettingsStoreRow>`
        SELECT key, value_json
        FROM settings_store
      `
    }),
  )

  const stored: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      stored[row.key] = parseJsonUnknown(row.value_json)
    } catch (error) {
      logger.warn('Failed to parse stored setting JSON', {
        key: row.key,
        error: describeError(error),
      })
    }
  }
  return stored
}

async function writeStoredSettingToDb(key: string, value: unknown): Promise<void> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO settings_store (key, value_json, updated_at)
        VALUES (${key}, ${JSON.stringify(value)}, ${Date.now()})
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `
    }),
  )
}

function queueStoredSettingWrite(key: string, value: unknown): void {
  writeQueue = writeQueue
    .then(() => writeStoredSettingToDb(key, value))
    .catch((error) => {
      logger.warn('Failed to write setting to SQLite', { key, error: describeError(error) })
    })
}

function getStoredValue(
  storedSettings: Readonly<Record<string, unknown>>,
  key: string,
): unknown | undefined {
  return Object.hasOwn(storedSettings, key) ? storedSettings[key] : undefined
}

function resolveProjectPath(raw: unknown): string | null {
  return isStringOrNull(raw) ? raw : DEFAULT_SETTINGS.projectPath
}

function resolveSelectedModel(
  raw: unknown,
  enabledModels: readonly SupportedModelId[],
): SupportedModelId {
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

function buildSettingsSnapshot(storedSettings: Readonly<Record<string, unknown>>): {
  readonly settings: Settings
} {
  const thinkingLevel = resolveThinkingLevel(
    getStoredValue(storedSettings, SETTINGS_KEY_THINKING_LEVEL),
  )
  const favoriteModels = resolveFavoriteModels(
    getStoredValue(storedSettings, SETTINGS_KEY_FAVORITE_MODELS),
  )
  const recentProjects = resolveRecentProjects(
    getStoredValue(storedSettings, SETTINGS_KEY_RECENT_PROJECTS),
  )
  const skillTogglesByProject = resolveSkillTogglesByProject(
    getStoredValue(storedSettings, SETTINGS_KEY_SKILL_TOGGLES_BY_PROJECT),
  )
  const enabledModels = resolveEnabledModels(
    getStoredValue(storedSettings, SETTINGS_KEY_ENABLED_MODELS),
  )
  const selectedModel = resolveSelectedModel(
    getStoredValue(storedSettings, SETTINGS_KEY_DEFAULT_MODEL),
    enabledModels,
  )
  const projectDisplayNames = sanitizeProjectDisplayNames(
    getStoredValue(storedSettings, SETTINGS_KEY_PROJECT_DISPLAY_NAMES) ??
      DEFAULT_SETTINGS.projectDisplayNames,
  )

  return {
    settings: {
      selectedModel: selectedModel,
      favoriteModels,
      enabledModels,
      projectPath: resolveProjectPath(getStoredValue(storedSettings, SETTINGS_KEY_PROJECT_PATH)),
      thinkingLevel,
      recentProjects,
      skillTogglesByProject,
      projectDisplayNames,
    },
  }
}

export async function initializeSettingsStore(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise
  }

  initializationPromise = (async () => {
    try {
      const storedSettings = await listStoredSettings()
      const built = buildSettingsSnapshot(storedSettings)
      settingsCache = built.settings

      if (built.settings.selectedModel !== storedSettings[SETTINGS_KEY_DEFAULT_MODEL]) {
        queueStoredSettingWrite(SETTINGS_KEY_DEFAULT_MODEL, built.settings.selectedModel)
      }
    } catch (error) {
      logger.warn('Failed to initialize settings cache from SQLite', {
        error: describeError(error),
      })
      settingsCache = createDefaultSettingsSnapshot()
    }
  })()

  await initializationPromise
}

export async function flushSettingsStoreForTests(): Promise<void> {
  await writeQueue
}

export function getSettings(): Settings {
  return settingsCache
}

export function updateSettings(partial: Partial<Settings>): void {
  const enabledModels =
    partial.enabledModels !== undefined
      ? sanitizeEnabledModels(partial.enabledModels)
      : settingsCache.enabledModels
  const selectedModel =
    partial.selectedModel !== undefined
      ? resolveSelectedModel(partial.selectedModel, enabledModels)
      : settingsCache.selectedModel
  const favoriteModels =
    partial.favoriteModels !== undefined
      ? sanitizeFavoriteModels(partial.favoriteModels)
      : settingsCache.favoriteModels
  const projectPath =
    partial.projectPath !== undefined ? partial.projectPath : settingsCache.projectPath
  const thinkingLevel =
    partial.thinkingLevel !== undefined && includes(THINKING_LEVELS, partial.thinkingLevel)
      ? partial.thinkingLevel
      : settingsCache.thinkingLevel
  const recentProjects =
    partial.recentProjects !== undefined
      ? sanitizeRecentProjects(partial.recentProjects)
      : settingsCache.recentProjects
  const skillTogglesByProject =
    partial.skillTogglesByProject !== undefined
      ? sanitizeSkillTogglesByProject(partial.skillTogglesByProject)
      : settingsCache.skillTogglesByProject
  const projectDisplayNames =
    partial.projectDisplayNames !== undefined
      ? sanitizeProjectDisplayNames(partial.projectDisplayNames)
      : settingsCache.projectDisplayNames

  settingsCache = {
    ...settingsCache,
    selectedModel: selectedModel,
    favoriteModels,
    enabledModels,
    projectPath,
    thinkingLevel,
    recentProjects,
    skillTogglesByProject,
    projectDisplayNames,
  }

  if (partial.selectedModel !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_DEFAULT_MODEL, selectedModel)
  }
  if (partial.favoriteModels !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_FAVORITE_MODELS, favoriteModels)
  }
  if (partial.projectPath !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_PROJECT_PATH, partial.projectPath)
  }
  if (partial.thinkingLevel !== undefined) {
    if (includes(THINKING_LEVELS, partial.thinkingLevel)) {
      queueStoredSettingWrite(SETTINGS_KEY_THINKING_LEVEL, partial.thinkingLevel)
    } else {
      logger.warn('Skipping invalid thinkingLevel', { value: partial.thinkingLevel })
    }
  }
  if (partial.recentProjects !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_RECENT_PROJECTS, recentProjects)
  }
  if (partial.skillTogglesByProject !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_SKILL_TOGGLES_BY_PROJECT, skillTogglesByProject)
  }
  if (partial.enabledModels !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_ENABLED_MODELS, enabledModels)
  }
  if (partial.projectDisplayNames !== undefined) {
    queueStoredSettingWrite(SETTINGS_KEY_PROJECT_DISPLAY_NAMES, projectDisplayNames)
  }
}

function resolveThinkingLevel(raw: unknown): ThinkingLevel {
  return typeof raw === 'string' && includes(THINKING_LEVELS, raw)
    ? raw
    : DEFAULT_SETTINGS.thinkingLevel
}

function resolveEnabledModels(raw: unknown): SupportedModelId[] {
  return Array.isArray(raw) && raw.every((value) => typeof value === 'string')
    ? sanitizeEnabledModels(raw)
    : [...DEFAULT_SETTINGS.enabledModels]
}

function normalizeStoredModelRef(raw: string): SupportedModelId | null {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  if (parseModelRef(trimmed)) {
    return SupportedModelId(trimmed)
  }

  return null
}

function sanitizeEnabledModels(models: readonly string[]): SupportedModelId[] {
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

function resolveFavoriteModels(raw: unknown): SupportedModelId[] {
  return Array.isArray(raw) && raw.every((value) => typeof value === 'string')
    ? sanitizeFavoriteModels(raw)
    : [...DEFAULT_SETTINGS.favoriteModels]
}

function resolveRecentProjects(raw: unknown): string[] {
  return Array.isArray(raw) && raw.every((value) => typeof value === 'string')
    ? sanitizeRecentProjects(raw)
    : [...DEFAULT_SETTINGS.recentProjects]
}

function resolveSkillTogglesByProject(raw: unknown): Record<string, Record<string, boolean>> {
  return isObjectRecord(raw)
    ? sanitizeSkillTogglesByProject(raw)
    : DEFAULT_SETTINGS.skillTogglesByProject
}

function sanitizeProjectDisplayNames(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key === 'string' && typeof value === 'string') {
      result[key] = value
    }
  }
  return result
}

function sanitizeFavoriteModels(models: readonly string[]): SupportedModelId[] {
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

function sanitizeRecentProjects(paths: readonly string[]): string[] {
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

function sanitizeSkillTogglesByProject(
  value: Readonly<Record<string, unknown>>,
): Record<string, Record<string, boolean>> {
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
