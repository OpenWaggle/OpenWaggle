import { stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  BrowserImportSourceId,
  BrowserImportSourceProfile,
} from '@shared/types/browser-import'
import { BROWSER_IMPORT_LIMITS } from '@shared/types/browser-import'

export type BrowserImportEngine = 'chromium' | 'firefox' | 'safari'

export interface BrowserImportPathContext {
  readonly home: string
  readonly platform: NodeJS.Platform
  readonly appData?: string
  readonly localAppData?: string
}

export interface BrowserImportSourceDefinition {
  readonly id: BrowserImportSourceId
  readonly name: string
  readonly engine: BrowserImportEngine
  readonly platforms: readonly NodeJS.Platform[]
  readonly userDataDirectory: (context: BrowserImportPathContext) => string | undefined
  readonly keychainAccount?: string
  readonly keychainService?: string
  readonly linuxSecretApplication?: string
  readonly directProfileName?: string
}

function macApplicationSupport(context: BrowserImportPathContext, ...segments: readonly string[]) {
  return path.join(context.home, 'Library', 'Application Support', ...segments)
}

function chromiumSource(input: {
  readonly id: BrowserImportSourceId
  readonly name: string
  readonly macSegments: readonly string[]
  readonly linuxSegments?: readonly string[]
  readonly windowsSegments?: readonly string[]
  readonly windowsBase?: 'local' | 'roaming'
  readonly directProfileName?: string
  readonly keychainAccount: string
  readonly keychainService: string
  readonly linuxSecretApplication?: string
}): BrowserImportSourceDefinition {
  return {
    ...input,
    engine: 'chromium',
    platforms: [
      'darwin',
      ...(input.linuxSegments ? (['linux'] as const) : []),
      ...(input.windowsSegments ? (['win32'] as const) : []),
    ],
    userDataDirectory: (context) => {
      if (context.platform === 'darwin') {
        return macApplicationSupport(context, ...input.macSegments)
      }
      if (context.platform === 'linux' && input.linuxSegments) {
        return path.join(context.home, '.config', ...input.linuxSegments)
      }
      if (context.platform === 'win32' && input.windowsSegments) {
        const base =
          input.windowsBase === 'roaming'
            ? (context.appData ?? path.win32.join(context.home, 'AppData', 'Roaming'))
            : (context.localAppData ?? path.win32.join(context.home, 'AppData', 'Local'))
        return path.win32.join(base, ...input.windowsSegments)
      }
      return undefined
    },
  }
}

export const BROWSER_IMPORT_SOURCES: readonly BrowserImportSourceDefinition[] = [
  chromiumSource({
    id: 'chrome',
    name: 'Chrome',
    macSegments: ['Google', 'Chrome'],
    linuxSegments: ['google-chrome'],
    linuxSecretApplication: 'chrome',
    keychainService: 'Chrome Safe Storage',
    keychainAccount: 'Chrome',
  }),
  chromiumSource({
    id: 'edge',
    name: 'Microsoft Edge',
    macSegments: ['Microsoft Edge'],
    linuxSegments: ['microsoft-edge'],
    linuxSecretApplication: 'msedge',
    keychainService: 'Microsoft Edge Safe Storage',
    keychainAccount: 'Microsoft Edge',
  }),
  chromiumSource({
    id: 'brave',
    name: 'Brave',
    macSegments: ['BraveSoftware', 'Brave-Browser'],
    linuxSegments: ['BraveSoftware', 'Brave-Browser'],
    linuxSecretApplication: 'brave',
    keychainService: 'Brave Safe Storage',
    keychainAccount: 'Brave',
  }),
  chromiumSource({
    id: 'vivaldi',
    name: 'Vivaldi',
    macSegments: ['Vivaldi'],
    linuxSegments: ['vivaldi'],
    linuxSecretApplication: 'vivaldi',
    keychainService: 'Vivaldi Safe Storage',
    keychainAccount: 'Vivaldi',
  }),
  chromiumSource({
    id: 'opera',
    name: 'Opera',
    macSegments: ['com.operasoftware.Opera'],
    linuxSegments: ['opera'],
    linuxSecretApplication: 'opera',
    keychainService: 'Opera Safe Storage',
    keychainAccount: 'Opera',
    directProfileName: 'Default',
  }),
  chromiumSource({
    id: 'arc',
    name: 'Arc',
    macSegments: ['Arc', 'User Data'],
    keychainService: 'Arc Safe Storage',
    keychainAccount: 'Arc',
  }),
  chromiumSource({
    id: 'helium',
    name: 'Helium',
    macSegments: ['net.imput.helium'],
    linuxSegments: ['net.imput.helium'],
    windowsSegments: ['imput', 'Helium', 'User Data'],
    linuxSecretApplication: 'chromium',
    keychainService: 'Helium Storage Key',
    keychainAccount: 'Helium',
  }),
  {
    id: 'firefox',
    name: 'Firefox',
    engine: 'firefox',
    platforms: ['darwin', 'linux', 'win32'],
    userDataDirectory: (context) => {
      if (context.platform === 'darwin') return macApplicationSupport(context, 'Firefox')
      if (context.platform === 'linux') return path.join(context.home, '.mozilla', 'firefox')
      return path.win32.join(
        context.appData ?? path.win32.join(context.home, 'AppData', 'Roaming'),
        'Mozilla',
        'Firefox',
      )
    },
  },
  {
    id: 'safari',
    name: 'Safari',
    engine: 'safari',
    platforms: ['darwin'],
    userDataDirectory: (context) =>
      path.join(
        context.home,
        'Library',
        'Containers',
        'com.apple.Safari',
        'Data',
        'Library',
        'Cookies',
      ),
  },
]

export function isSafeBrowserProfileDirectory(directory: string) {
  return (
    directory.length > 0 &&
    directory !== '.' &&
    directory !== '..' &&
    !/[\\/]/u.test(directory) &&
    !directory.includes('\u0000')
  )
}

interface FirefoxProfileSection {
  name?: string
  profilePath?: string
  isRelative?: string
}

function resolveFirefoxProfileDirectory(candidate: string, root: string, isRelative: boolean) {
  if (!isRelative) {
    const resolved = path.normalize(candidate)
    return path.isAbsolute(resolved) ? resolved : undefined
  }
  if (path.isAbsolute(candidate)) return undefined
  const resolved = path.resolve(root, candidate)
  const relative = path.relative(root, resolved)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined
  }
  return path.normalize(candidate)
}

function firefoxSourceProfile(
  section: FirefoxProfileSection | null,
  root: string,
): BrowserImportSourceProfile | undefined {
  if (!section?.profilePath || section.profilePath.includes('\u0000')) return undefined
  const candidate = section.profilePath
  const relativeSetting = section.isRelative
  if (relativeSetting !== undefined && !/^[01]$/u.test(relativeSetting)) return undefined
  const isRelative = relativeSetting !== '0'
  const directory = resolveFirefoxProfileDirectory(candidate, root, isRelative)
  if (directory === undefined) return undefined
  return {
    directory,
    name: section.name?.trim() || candidate,
  }
}

export function parseFirefoxProfiles(ini: string, root: string) {
  const profiles: BrowserImportSourceProfile[] = []
  let current: FirefoxProfileSection | null = null

  const flush = () => {
    const profile = firefoxSourceProfile(current, root)
    if (profile) profiles.push(profile)
    current = null
  }

  for (const rawLine of ini.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line.startsWith('[')) {
      flush()
      current = /^\[Profile\d+\]$/iu.test(line) ? {} : null
      continue
    }
    if (current === null) continue
    const separator = line.indexOf('=')
    if (separator < 0) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (key === 'name') current.name = value
    if (key === 'path') current.profilePath = value
    if (key === 'isrelative') current.isRelative = value
  }
  flush()
  return profiles.slice(0, BROWSER_IMPORT_LIMITS.SOURCE_PROFILES)
}

export function cookieDatabaseCandidates(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  profileDirectory: string,
) {
  const root = definition.userDataDirectory(context)
  if (root === undefined) return []
  if (definition.engine === 'safari') {
    const defaultProfile = profileDirectory === '.' || profileDirectory === 'Default'
    const profileRoot = defaultProfile
      ? root
      : path.isAbsolute(profileDirectory)
        ? profileDirectory
        : path.join(root, profileDirectory)
    const current = path.join(profileRoot, 'Cookies.binarycookies')
    return defaultProfile
      ? [current, path.join(context.home, 'Library', 'Cookies', 'Cookies.binarycookies')]
      : [current]
  }
  const profileRoot = path.isAbsolute(profileDirectory)
    ? profileDirectory
    : context.platform === 'win32'
      ? path.win32.join(root, profileDirectory)
      : path.join(root, profileDirectory)
  const pathForPlatform = context.platform === 'win32' ? path.win32 : path
  if (definition.engine === 'firefox') return [pathForPlatform.join(profileRoot, 'cookies.sqlite')]
  return [
    pathForPlatform.join(profileRoot, 'Network', 'Cookies'),
    pathForPlatform.join(profileRoot, 'Cookies'),
  ]
}

async function regularFile(filePath: string) {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

export async function resolveCookieDatabase(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  profileDirectory: string,
) {
  for (const candidate of cookieDatabaseCandidates(definition, context, profileDirectory)) {
    if (await regularFile(candidate)) return candidate
  }
  return undefined
}

export function browserImportSourceDefinition(sourceId: BrowserImportSourceId) {
  return BROWSER_IMPORT_SOURCES.find((source) => source.id === sourceId)
}
