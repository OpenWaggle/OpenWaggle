import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { decodeUnknownOrThrow, parseJsonUnknown, safeDecodeUnknown } from '@shared/schema'
import { projectSettingsFileSchema } from '@shared/schemas/validation'
import {
  type AgentAuthorizationScopeKey,
  authorizationScopeKeysMatch,
  type ScopedAuthorizationGrant,
} from '@shared/types/agent-authorization-grants'
import { isEnoent, isNodeError } from '@shared/utils/node-error'
import { createLogger } from '../logger'
import {
  type ParsedProjectSettingsFile,
  type ProjectConfig,
  type ProjectPreferences,
  type ProjectPreferencesUpdate,
  parseProjectConfig,
} from './project-config-parsing'
import { enqueueProjectConfigWrite } from './project-config-write-queue'

export type { ProjectConfig, ProjectPreferences, ProjectPreferencesUpdate }

const JSON_INDENT_SPACES = 2
const OPENWAGGLE_CONFIG_DIR = '.openwaggle'
const PROJECT_SETTINGS_FILE_NAME = 'settings.json'
const EMPTY_SETTINGS_JSON = '{}\n'

const logger = createLogger('project-config')

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
    if (options.strict && raw.trim().length === 0) {
      throw new Error('Empty project settings file cannot be used for permission-sensitive reads.')
    }
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
      if (options.strict) {
        try {
          await lstat(filePath)
          throw new Error('Project settings file exists but cannot be read.', { cause: error })
        } catch (fileError) {
          if (!isEnoent(fileError)) throw fileError
        }
        const directory = await lstat(dirname(filePath)).catch((directoryError: unknown) => {
          if (isEnoent(directoryError)) return null
          throw directoryError
        })
        if (directory?.isSymbolicLink()) await stat(dirname(filePath))
      }
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

/** Permission-sensitive callers must distinguish absence from an unreadable or invalid file. */
export async function loadProjectConfigStrict(projectPath: string): Promise<ProjectConfig> {
  const settings = await readValidatedProjectSettings(getProjectSettingsPath(projectPath), {
    strict: true,
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
    try {
      await writeFile(configPath, EMPTY_SETTINGS_JSON, { encoding: 'utf-8', flag: 'wx' })
    } catch (writeError) {
      if (!isNodeError(writeError, 'EEXIST')) throw writeError
    }
  }

  return configPath
}

export async function ensureProjectSettingsFile(projectPath: string): Promise<string> {
  return ensureSettingsFile(projectPath, getProjectSettingsPath(projectPath))
}

/**
 * Hook the application layer installs at startup: durably captures a retired legacy preference
 * into its new store before the file write strips it. The config module stays store-free; the
 * hook keeps "migrate, then strip" lossless for every project-config writer.
 */
type LegacyPreferenceMigrator = (projectPath: string, value: string) => Promise<void>
let legacyPreferenceMigrator: LegacyPreferenceMigrator | null = null

export function installLegacyPreferenceMigrator(migrator: LegacyPreferenceMigrator | null): void {
  legacyPreferenceMigrator = migrator
}

async function migrateRetiredLegacyPreference(
  projectPath: string,
  value: string,
): Promise<boolean> {
  if (!legacyPreferenceMigrator) return true
  try {
    await legacyPreferenceMigrator(projectPath, value)
    return true
  } catch (error) {
    logger.warn('Failed to migrate a retired project preference before stripping it', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/** Removes retired preference keys whose values now live elsewhere; only after a safe migration. */
function stripRetiredPreferences(next: ParsedProjectSettingsFile): ParsedProjectSettingsFile {
  if (next.preferences?.model === undefined) return next
  const { model: _legacyModel, ...rest } = next.preferences
  if (Object.keys(rest).length === 0) {
    const { preferences: _retired, ...withoutPreferences } = next
    return withoutPreferences
  }
  return { ...next, preferences: rest }
}

async function updateProjectSettingsFile(
  configPath: string,
  projectPath: string,
  updater: (current: ParsedProjectSettingsFile) => ParsedProjectSettingsFile,
) {
  const current =
    (await readValidatedProjectSettings(configPath, {
      strict: true,
      logLabel: '.openwaggle/settings.json',
    })) ?? decodeUnknownOrThrow(projectSettingsFileSchema, {})

  // The selected model moved to the app DB. Capture a legacy file value before this rewrite
  // strips it, so no project-config writer can lose the user's override.
  const legacyModel = current.preferences?.model
  const migrationSucceeded =
    legacyModel === undefined || (await migrateRetiredLegacyPreference(projectPath, legacyModel))

  const updated = decodeUnknownOrThrow(projectSettingsFileSchema, updater(current))
  const next = migrationSucceeded ? stripRetiredPreferences(updated) : updated

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

export async function updateProjectConfig(
  projectPath: string,
  updater: (current: ParsedProjectSettingsFile) => ParsedProjectSettingsFile,
): Promise<ProjectConfig> {
  const configPath = getProjectSettingsPath(projectPath)
  const next = await enqueueProjectConfigWrite(configPath, async () => {
    await ensureSettingsFile(projectPath, configPath)
    return updateProjectSettingsFile(configPath, projectPath, updater)
  })
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
  return (await loadProjectConfigStrict(projectPath)).preferences
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
    for (const key of ['thinkingLevel', 'authorizationMode'] as const) {
      const value = preferences[key]
      if (value === undefined) continue
      if (value === null) {
        delete next[key]
        continue
      }
      next[key] = value
    }

    const { preferences: _previous, ...rest } = current
    return Object.keys(next).length > 0 ? { ...rest, preferences: next } : rest
  })
}

/** Every persistent grant recorded for a project. */
export async function listProjectAuthorizationGrants(
  projectPath: string,
): Promise<readonly ScopedAuthorizationGrant[]> {
  const config = await loadProjectConfigStrict(projectPath)
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
          requesterId: key.requesterId,
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
