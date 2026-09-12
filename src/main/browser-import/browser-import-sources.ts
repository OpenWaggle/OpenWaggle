import { access, readdir, readFile, readlink, stat } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  BrowserImportSource,
  BrowserImportSourceProfile,
  BrowserImportUnavailableReason,
} from '@shared/types/browser-import'
import { BROWSER_IMPORT_LIMITS } from '@shared/types/browser-import'
import { getBrowserImportPathEnv } from '../env'
import { browserImportFilePermissionReason } from './browser-import-errors'
import {
  BROWSER_IMPORT_SOURCES,
  type BrowserImportPathContext,
  type BrowserImportSourceDefinition,
  browserImportSourceDefinition,
  cookieDatabaseCandidates,
  isSafeBrowserProfileDirectory,
  parseFirefoxProfiles,
  resolveCookieDatabase,
} from './browser-import-source-definitions'
import { listSafariProfiles } from './safari-profile-discovery'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function listChromiumProfiles(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
) {
  const root = definition.userDataDirectory(context)
  if (root === undefined) return []
  let declared: BrowserImportSourceProfile[] = []
  try {
    const localStatePath = path.join(root, 'Local State')
    const localStateStat = await stat(localStatePath)
    if (localStateStat.size > BROWSER_IMPORT_LIMITS.LOCAL_STATE_BYTES) return []
    const state: unknown = JSON.parse(await readFile(localStatePath, 'utf8'))
    if (isRecord(state)) {
      const profile = state.profile
      if (isRecord(profile)) {
        const cache = profile.info_cache
        if (isRecord(cache)) {
          declared = Object.entries(cache).flatMap(([directory, info]) => {
            if (!isSafeBrowserProfileDirectory(directory)) return []
            const name = isRecord(info) && typeof info.name === 'string' ? info.name.trim() : ''
            return [{ directory, name: name || directory }]
          })
        }
      }
    }
  } catch {
    declared = []
  }
  if (declared.length === 0 && definition.directProfileName) {
    const directDatabase = await resolveCookieDatabase(definition, context, '.')
    if (directDatabase) {
      return [
        {
          directory: '.',
          name: definition.directProfileName,
          cookieCount: countProfileCookies(definition, directDatabase),
        },
      ]
    }
  }
  const candidates = declared.length > 0 ? declared : await scanDirectories(root)
  const profiles = await filterProfilesWithCookieDatabase(definition, context, candidates)
  return profiles
}

async function scanDirectories(root: string) {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && isSafeBrowserProfileDirectory(entry.name))
      .slice(0, BROWSER_IMPORT_LIMITS.SOURCE_PROFILES)
      .map((entry) => ({ directory: entry.name, name: entry.name }))
  } catch {
    return []
  }
}

async function filterProfilesWithCookieDatabase(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  profiles: readonly BrowserImportSourceProfile[],
) {
  const found = await Promise.all(
    profiles.slice(0, BROWSER_IMPORT_LIMITS.SOURCE_PROFILES).map(async (profile) => {
      const database = await resolveCookieDatabase(definition, context, profile.directory)
      if (!database) return undefined
      const cookieCount = countProfileCookies(definition, database)
      return cookieCount === undefined ? profile : { ...profile, cookieCount }
    }),
  )
  return found.filter((profile) => profile !== undefined)
}

function countProfileCookies(definition: BrowserImportSourceDefinition, databasePath: string) {
  if (definition.engine === 'safari') return undefined
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(databasePath, { readOnly: true })
    const query =
      definition.engine === 'firefox'
        ? "SELECT count(*) AS count FROM moz_cookies WHERE originAttributes = ''"
        : 'SELECT count(*) AS count FROM cookies'
    const value = database.prepare(query).get()?.count
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value
      : undefined
  } catch {
    return undefined
  } finally {
    database?.close()
  }
}

async function listFirefoxProfilesInRoot(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  root: string,
) {
  const rootedDefinition = { ...definition, userDataDirectory: () => root }
  let declared: BrowserImportSourceProfile[]
  try {
    declared = parseFirefoxProfiles(await readFile(path.join(root, 'profiles.ini'), 'utf8'), root)
  } catch {
    declared = []
  }
  const filtered = await filterProfilesWithCookieDatabase(rootedDefinition, context, declared)
  if (filtered.length > 0) return filtered
  const scanRoot = context.platform === 'linux' ? root : path.join(root, 'Profiles')
  const scanned = await scanDirectories(scanRoot)
  const candidates = scanned.map((profile) => ({
    ...profile,
    directory:
      context.platform === 'linux' ? profile.directory : path.join('Profiles', profile.directory),
  }))
  return filterProfilesWithCookieDatabase(rootedDefinition, context, candidates)
}

async function listFirefoxProfiles(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
) {
  const root = definition.userDataDirectory(context)
  if (root === undefined) return []
  if (context.platform !== 'linux') {
    return listFirefoxProfilesInRoot(definition, context, root)
  }
  const snapRoot = path.join(context.home, 'snap', 'firefox', 'common', '.mozilla', 'firefox')
  const profiles = new Map<string, BrowserImportSourceProfile>()
  for (const candidateRoot of [root, snapRoot]) {
    const found = await listFirefoxProfilesInRoot(definition, context, candidateRoot)
    for (const profile of found) {
      const absolute = path.resolve(candidateRoot, profile.directory)
      if (profiles.has(absolute)) continue
      profiles.set(absolute, candidateRoot === root ? profile : { ...profile, directory: absolute })
    }
  }
  return [...profiles.values()].slice(0, BROWSER_IMPORT_LIMITS.SOURCE_PROFILES)
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return !(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ESRCH'
    )
  }
}

async function chromiumSourceIsRunning(root: string, platform: NodeJS.Platform) {
  if (platform === 'win32') return false
  try {
    const target = await readlink(path.join(root, 'SingletonLock'))
    const separator = target.lastIndexOf('-')
    if (separator <= 0) return true
    if (target.slice(0, separator) !== hostname()) return true
    const pidText = target.slice(separator + 1)
    if (!/^\d+$/u.test(pidText)) return true
    const pid = Number(pidText)
    return Number.isSafeInteger(pid) && pid > 0 ? processIsAlive(pid) : true
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    return true
  }
}

function fileErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

async function sourcePermissionDenied(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  root: string,
) {
  const candidates = [root, ...cookieDatabaseCandidates(definition, context, 'Default')]
  for (const candidate of candidates) {
    try {
      await access(candidate)
    } catch (error) {
      const reason = browserImportFilePermissionReason(
        definition.id,
        context.platform,
        fileErrorCode(error),
      )
      if (reason) return reason
    }
  }
  return undefined
}

function unavailableSource(
  definition: BrowserImportSourceDefinition,
  unavailable: BrowserImportUnavailableReason,
  profiles: readonly BrowserImportSourceProfile[] = [],
): BrowserImportSource {
  return { id: definition.id, name: definition.name, profiles, unavailable }
}

async function listSourceProfiles(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
): Promise<readonly BrowserImportSourceProfile[]> {
  if (definition.engine === 'chromium') return listChromiumProfiles(definition, context)
  if (definition.engine === 'firefox') return listFirefoxProfiles(definition, context)
  const root = definition.userDataDirectory(context)
  if (root === undefined) return []
  return filterProfilesWithCookieDatabase(definition, context, await listSafariProfiles(root))
}

async function profileDatabasePermissionDenied(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  profile: BrowserImportSourceProfile,
) {
  try {
    const database = await resolveCookieDatabase(definition, context, profile.directory)
    if (database) await access(database)
    return false
  } catch (error: unknown) {
    return browserImportFilePermissionReason(definition.id, context.platform, fileErrorCode(error))
  }
}

async function inspectBrowserImportSource(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
): Promise<BrowserImportSource> {
  if (!definition.platforms.includes(context.platform)) {
    return unavailableSource(definition, 'unsupported-platform')
  }
  const root = definition.userDataDirectory(context)
  if (root === undefined) return unavailableSource(definition, 'unsupported-platform')
  const sourcePermissionFailure = await sourcePermissionDenied(definition, context, root)
  if (sourcePermissionFailure) {
    return unavailableSource(definition, sourcePermissionFailure)
  }
  const profiles = await listSourceProfiles(definition, context)
  if (profiles.length === 0) return unavailableSource(definition, 'not-installed')
  if (definition.engine === 'chromium' && (await chromiumSourceIsRunning(root, context.platform))) {
    return unavailableSource(definition, 'browser-running', profiles)
  }
  const firstProfile = profiles[0]
  const profilePermissionFailure = firstProfile
    ? await profileDatabasePermissionDenied(definition, context, firstProfile)
    : undefined
  if (profilePermissionFailure) {
    return unavailableSource(definition, profilePermissionFailure, profiles)
  }
  return { id: definition.id, name: definition.name, profiles }
}

export async function listBrowserImportSources(
  context: BrowserImportPathContext = defaultBrowserImportPathContext(),
): Promise<readonly BrowserImportSource[]> {
  return Promise.all(
    BROWSER_IMPORT_SOURCES.filter((definition) =>
      definition.platforms.includes(context.platform),
    ).map((definition) => inspectBrowserImportSource(definition, context)),
  )
}

export function defaultBrowserImportPathContext(): BrowserImportPathContext {
  return { home: homedir(), platform: process.platform, ...getBrowserImportPathEnv() }
}

export { browserImportSourceDefinition }
