import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getAgentDir, SettingsManager } from '@mariozechner/pi-coding-agent'
import { decodeUnknownOrThrow } from '@shared/schema'
import { jsonObjectSchema, projectSettingsFileSchema } from '@shared/schemas/validation'
import type { JsonObject, JsonValue } from '@shared/types/json'

const JSON_INDENT_SPACES = 2
const OPENWAGGLE_CONFIG_DIR = '.openwaggle'
const PI_CONFIG_DIR = '.pi'
const SETTINGS_FILE_NAME = 'settings.json'

type SettingsScope = 'global' | 'project'

interface SettingsStorageLike {
  withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void
}

function getOpenWaggleProjectSettingsPath(projectPath: string): string {
  return join(projectPath, OPENWAGGLE_CONFIG_DIR, SETTINGS_FILE_NAME)
}

function getPiProjectSettingsPath(projectPath: string): string {
  return join(projectPath, PI_CONFIG_DIR, SETTINGS_FILE_NAME)
}

function getPiGlobalSettingsPath(): string {
  return join(getAgentDir(), SETTINGS_FILE_NAME)
}

function readFileIfPresent(filePath: string): string | undefined {
  return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined
}

function writeJsonFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
}

function parseJsonObject(content: string | undefined): JsonObject {
  if (!content || content.trim().length === 0) {
    return {}
  }
  const parsed: unknown = JSON.parse(content)
  return decodeUnknownOrThrow(jsonObjectSchema, parsed)
}

function parseOpenWaggleSettings(content: string | undefined): JsonObject {
  if (!content || content.trim().length === 0) {
    return {}
  }
  const parsed: unknown = JSON.parse(content)
  return decodeUnknownOrThrow(projectSettingsFileSchema, parsed)
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeJsonObjects(base: JsonObject, override: JsonObject): JsonObject {
  const result: JsonObject = { ...base }
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = result[key]
    result[key] =
      isJsonObject(baseValue) && isJsonObject(overrideValue)
        ? mergeJsonObjects(baseValue, overrideValue)
        : overrideValue
  }
  return result
}

function serializeJsonObject(value: JsonObject): string {
  return `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`
}

function readProjectPiSettings(projectPath: string): JsonObject {
  const piProjectSettings = parseJsonObject(
    readFileIfPresent(getPiProjectSettingsPath(projectPath)),
  )
  const openWaggleSettings = parseOpenWaggleSettings(
    readFileIfPresent(getOpenWaggleProjectSettingsPath(projectPath)),
  )
  const openWagglePiSettings = openWaggleSettings.pi
  return isJsonObject(openWagglePiSettings)
    ? mergeJsonObjects(piProjectSettings, openWagglePiSettings)
    : piProjectSettings
}

function writeProjectPiSettings(projectPath: string, nextPiSettings: string): void {
  const nextPi = parseJsonObject(nextPiSettings)
  const settingsPath = getOpenWaggleProjectSettingsPath(projectPath)
  const currentOpenWaggleSettings = parseOpenWaggleSettings(readFileIfPresent(settingsPath))
  writeJsonFile(
    settingsPath,
    serializeJsonObject({
      ...currentOpenWaggleSettings,
      pi: nextPi,
    }),
  )
}

function createOpenWagglePiSettingsStorage(projectPath: string): SettingsStorageLike {
  return {
    withLock(scope, fn) {
      if (scope === 'global') {
        const globalSettingsPath = getPiGlobalSettingsPath()
        const next = fn(readFileIfPresent(globalSettingsPath))
        if (next !== undefined) {
          writeJsonFile(globalSettingsPath, next)
        }
        return
      }

      const next = fn(serializeJsonObject(readProjectPiSettings(projectPath)))
      if (next !== undefined) {
        writeProjectPiSettings(projectPath, next)
      }
    },
  }
}

export function createOpenWagglePiSettingsManager(projectPath: string): SettingsManager {
  return SettingsManager.fromStorage(createOpenWagglePiSettingsStorage(projectPath))
}
