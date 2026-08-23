import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  decodeUnknownOrThrow,
  parseJsonUnknown,
  type SchemaType,
  safeDecodeUnknown,
} from '@shared/schema'
import { projectSettingsFileSchema } from '@shared/schemas/validation'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import {
  type AgentAuthorizationScopeKey,
  authorizationScopeKeysMatch,
  type ScopedAuthorizationGrant,
} from '@shared/types/agent-authorization-grants'
import type { JsonObject } from '@shared/types/json'
import type { ThinkingLevel } from '@shared/types/settings'
import { isEnoent } from '@shared/utils/node-error'
import { createLogger } from '../logger'

const JSON_INDENT_SPACES = 2
const OPENWAGGLE_CONFIG_DIR = '.openwaggle'
const PROJECT_SETTINGS_FILE_NAME = 'settings.json'
const EMPTY_SETTINGS_JSON = '{}\n'

const logger = createLogger('project-config')

export interface ProjectPreferences {
  readonly model?: string
  readonly thinkingLevel?: ThinkingLevel
  readonly authorizationMode?: AgentAuthorizationMode
}

/** A preference write, where `null` deletes the key and `undefined` leaves it alone. */
export interface ProjectPreferencesUpdate {
  readonly model?: string | null
  readonly thinkingLevel?: ThinkingLevel | null
  readonly authorizationMode?: AgentAuthorizationMode | null
}

export interface ProjectConfig {
  readonly preferences?: ProjectPreferences
  readonly authorizationGrants?: readonly ScopedAuthorizationGrant[]
  readonly pi?: JsonObject
}

const EMPTY_CONFIG: ProjectConfig = {}
type ParsedProjectSettingsFile = SchemaType<typeof projectSettingsFileSchema>

function getConfigDirectoryPath(projectPath: string) {
  return join(projectPath, OPENWAGGLE_CONFIG_DIR)
}

export function getProjectSettingsPath(projectPath: string): string {
  return join(getConfigDirectoryPath(projectPath), PROJECT_SETTINGS_FILE_NAME)
}

function getConfigTempPath(configPath: string) {
  return `${configPath}.${randomUUID()}.tmp`
}

function parseSettingsJson(raw: string) {
  return raw.trim().length > 0 ? parseJsonUnknown(raw) : {}
}

async function readValidatedProjectSettings(
  filePath: string,
  options: {
    strict: boolean
    logLabel: string
  },
) {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsedJson = parseSettingsJson(raw)
    const validated = safeDecodeUnknown(projectSettingsFileSchema, parsedJson)
    if (!validated.success) {
      const message = `Invalid project settings schema: ${validated.issues.join('; ')}`
      if (options.strict) {
        throw new Error(message)
      }
      logger.warn(`Failed to validate ${options.logLabel}`, { message })
      return null
    }
    return validated.data
  } catch (error) {
    if (isEnoent(error)) {
      return null
    }
    if (options.strict) {
      throw error
    }
    logger.warn(`Failed to parse ${options.logLabel}`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig> {
  const settingsPath = getProjectSettingsPath(projectPath)

  const settings = await readValidatedProjectSettings(settingsPath, {
    strict: false,
    logLabel: '.openwaggle/settings.json',
  })

  return parseProjectConfig(settings)
}

async function ensureSettingsFile(projectPath: string, configPath: string) {
  const configDir = getConfigDirectoryPath(projectPath)

  await mkdir(configDir, { recursive: true })

  try {
    await stat(configPath)
  } catch (error) {
    if (!isEnoent(error)) {
      throw error
    }
    await writeFile(configPath, EMPTY_SETTINGS_JSON, 'utf-8')
  }

  return configPath
}

export async function ensureProjectSettingsFile(projectPath: string): Promise<string> {
  return ensureSettingsFile(projectPath, getProjectSettingsPath(projectPath))
}

async function updateProjectSettingsFile(
  configPath: string,
  updater: (current: ParsedProjectSettingsFile) => ParsedProjectSettingsFile,
) {
  const current =
    (await readValidatedProjectSettings(configPath, {
      strict: true,
      logLabel: '.openwaggle/settings.json',
    })) ?? decodeUnknownOrThrow(projectSettingsFileSchema, {})
  const next = decodeUnknownOrThrow(projectSettingsFileSchema, updater(current))

  const serialized = `${JSON.stringify(next, null, JSON_INDENT_SPACES)}\n`
  const tempPath = getConfigTempPath(configPath)

  try {
    await writeFile(tempPath, serialized, 'utf-8')
    await rename(tempPath, configPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }

  return next
}

/**
 * Serializes writes per project, because every write is read-modify-write.
 *
 * Two overlapping calls both read the pre-change file and the second `rename` wins, silently dropping
 * the first change. That is reachable in normal use: a run can raise several authorization requests
 * close together, and "Always allow" on two of them would keep only one grant while the UI reported
 * both as saved.
 *
 * A per-path promise chain, not a lock library: the critical section is one small file write.
 */
const projectWriteQueues = new Map<string, Promise<unknown>>()

function enqueueProjectWrite<T>(configPath: string, operation: () => Promise<T>): Promise<T> {
  const previous = projectWriteQueues.get(configPath) ?? Promise.resolve()
  // Swallow the predecessor's rejection so one failed write does not fail the next caller.
  const result = previous.then(operation, operation)
  projectWriteQueues.set(
    configPath,
    result.catch(() => undefined),
  )
  return result
}

export async function updateProjectConfig(
  projectPath: string,
  updater: (current: ParsedProjectSettingsFile) => ParsedProjectSettingsFile,
): Promise<ProjectConfig> {
  const configPath = await ensureProjectSettingsFile(projectPath)
  const next = await enqueueProjectWrite(configPath, () =>
    updateProjectSettingsFile(configPath, updater),
  )
  return parseProjectConfig(next)
}

export async function getProjectPreferences(
  projectPath: string,
): Promise<ProjectPreferences | undefined> {
  const config = await loadProjectConfig(projectPath)
  return config.preferences
}

/**
 * Reads project preferences, THROWING when the settings file exists but cannot be understood.
 *
 * `getProjectPreferences` is deliberately lenient: one bad field must not stop a project from
 * opening, so an invalid file is logged and treated as empty. That is wrong for the authorization
 * default, because "empty" falls through to the global default, which ships as full access. A
 * project deliberately set to Ask for Approval would silently stop asking after a hand edit, a
 * partial write, or a downgrade from a build that knows a newer grant capability.
 *
 * A missing file still resolves to `undefined`: absence genuinely means "inherit". Only an
 * unreadable or invalid file throws, so the caller can fail closed.
 */
export async function getProjectPreferencesStrict(
  projectPath: string,
): Promise<ProjectPreferences | undefined> {
  const settings = await readValidatedProjectSettings(getProjectSettingsPath(projectPath), {
    logLabel: '.openwaggle/settings.json',
    strict: true,
  })

  return parseProjectConfig(settings).preferences
}

/**
 * Writes project preferences.
 *
 * `undefined` leaves a key untouched. An explicit `null` DELETES it, which is how a project override
 * is cleared so the project inherits the global default again. Without the null path a user who once
 * set a project default could never return that project to inheriting.
 */
export async function setProjectPreferences(
  projectPath: string,
  preferences: ProjectPreferencesUpdate,
): Promise<void> {
  await updateProjectConfig(projectPath, (current) => {
    const next: Record<string, unknown> = { ...current.preferences }
    for (const key of ['model', 'thinkingLevel', 'authorizationMode'] as const) {
      const value = preferences[key]
      if (value === undefined) continue
      if (value === null) {
        delete next[key]
        continue
      }
      next[key] = value
    }

    return { ...current, preferences: next }
  })
}

/** Every persistent grant recorded for a project. */
export async function listProjectAuthorizationGrants(
  projectPath: string,
): Promise<readonly ScopedAuthorizationGrant[]> {
  const config = await loadProjectConfig(projectPath)
  return config.authorizationGrants ?? []
}

/** Records a persistent grant, replacing any existing grant for the same key. */
export async function grantProjectAuthorization(
  projectPath: string,
  key: AgentAuthorizationScopeKey,
  grantedAt = Date.now(),
): Promise<void> {
  await updateProjectConfig(projectPath, (current) => {
    const existing = current.authorizationGrants ?? []
    const withoutKey = existing.filter((grant) => !authorizationScopeKeysMatch(grant, key))
    return {
      ...current,
      authorizationGrants: [
        ...withoutKey,
        {
          requester: key.requester,
          capability: key.capability,
          ...(key.resource === undefined ? {} : { resource: key.resource }),
          grantedAt,
        },
      ],
    }
  })
}

/**
 * Removes a persistent grant.
 *
 * Takes effect from the next request. A call already authorised and in flight cannot be un-made, so
 * revoking never reaches backwards.
 */
export async function revokeProjectAuthorization(
  projectPath: string,
  key: AgentAuthorizationScopeKey,
): Promise<void> {
  await updateProjectConfig(projectPath, (current) => {
    const existing = current.authorizationGrants ?? []
    const remaining = existing.filter((grant) => !authorizationScopeKeysMatch(grant, key))
    if (remaining.length === existing.length) return current

    const next = { ...current }
    if (remaining.length === 0) {
      delete next.authorizationGrants
      return next
    }
    return { ...next, authorizationGrants: remaining }
  })
}

function parseProjectConfig(settings: ParsedProjectSettingsFile | null) {
  const preferences = parseProjectPreferences(settings)
  const grants = settings?.authorizationGrants ?? []

  if (!preferences && grants.length === 0 && !settings?.pi) {
    return EMPTY_CONFIG
  }

  return {
    ...(preferences ? { preferences } : {}),
    ...(grants.length > 0 ? { authorizationGrants: grants } : {}),
    ...(settings?.pi ? { pi: settings.pi } : {}),
  }
}

function parseProjectPreferences(
  settings: ParsedProjectSettingsFile | null,
): ProjectPreferences | undefined {
  const model = settings?.preferences?.model
  const thinkingLevel = settings?.preferences?.thinkingLevel
  const authorizationMode = settings?.preferences?.authorizationMode
  if (!model && !thinkingLevel && !authorizationMode) {
    return undefined
  }

  return {
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(authorizationMode ? { authorizationMode } : {}),
  }
}
