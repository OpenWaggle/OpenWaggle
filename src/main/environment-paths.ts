import { delimiter, join } from 'node:path'

const MACOS_NPM_COMPATIBLE_PATH_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
]
const POSIX_NPM_COMPATIBLE_PATH_DIRS = ['/usr/local/bin', '/usr/bin', '/bin']
const POSIX_USER_TOOL_PATH_SEGMENTS = [
  ['.local', 'bin'],
  ['.volta', 'bin'],
  ['.asdf', 'shims'],
  ['.mise', 'shims'],
  ['.cargo', 'bin'],
  ['.bun', 'bin'],
  ['.deno', 'bin'],
] as const
const MACOS_USER_TOOL_PATH_SEGMENTS = [['Library', 'pnpm']] as const
const INTERACTIVE_TERMINAL_ENV_BLOCKLIST = new Set([
  'ELECTRON_ENABLE_LOGGING',
  'ELECTRON_ENABLE_STACK_DUMPING',
  'ELECTRON_FORCE_IS_PACKAGED',
  'ELECTRON_LOG_ASAR_READS',
  'ELECTRON_NO_ASAR',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_RENDERER_PORT',
  'ELECTRON_RENDERER_URL',
  'ELECTRON_RUN_AS_NODE',
  'NODE_CHANNEL_FD',
  'NODE_CHANNEL_SERIALIZATION_MODE',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_REPL_EXTERNAL_MODULE',
  'NODE_UNIQUE_ID',
])
const APPIMAGE_RUNTIME_ENV_KEYS = ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD'] as const
const APPIMAGE_PATH_LIKE_ENV_KEYS = [
  'PATH',
  'LD_LIBRARY_PATH',
  'XDG_DATA_DIRS',
  'GSETTINGS_SCHEMA_DIR',
] as const

export function buildNpmCompatiblePath(
  existingPath: string | undefined,
  platform: NodeJS.Platform,
  homeDir: string,
) {
  const result: string[] = []
  const seen = new Set<string>()
  const addPath = (value: string | undefined) => {
    if (!value || seen.has(value)) return
    seen.add(value)
    result.push(value)
  }
  for (const value of (existingPath ?? '').split(delimiter)) addPath(value)
  for (const value of userToolPathDirs(platform, homeDir)) addPath(value)
  for (const value of npmCompatiblePathDirs(platform)) addPath(value)
  return result.join(delimiter)
}

export function shouldExcludeInteractiveTerminalEnvKey(key: string) {
  const normalized = key.toUpperCase()
  return (
    normalized.startsWith('OPENWAGGLE_') ||
    normalized.startsWith('T3CODE_') ||
    INTERACTIVE_TERMINAL_ENV_BLOCKLIST.has(normalized)
  )
}

export function readEnvironmentValue(environment: Readonly<Record<string, string>>, name: string) {
  const normalizedName = name.toUpperCase()
  for (const [key, value] of Object.entries(environment)) {
    if (key.toUpperCase() === normalizedName) return value
  }
  return undefined
}

function deleteEnvironmentValue(environment: Record<string, string>, name: string) {
  const normalizedName = name.toUpperCase()
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === normalizedName) delete environment[key]
  }
}

export function setEnvironmentValue(
  environment: Record<string, string>,
  name: string,
  value: string,
) {
  deleteEnvironmentValue(environment, name)
  environment[name] = value
}

export function stripAppImageRuntimeEnv(environment: Record<string, string>) {
  const appImage = readEnvironmentValue(environment, 'APPIMAGE')
  const appDirValue = readEnvironmentValue(environment, 'APPDIR')
  if (appImage === undefined && appDirValue === undefined) return environment
  const scrubbed = { ...environment }
  for (const key of APPIMAGE_RUNTIME_ENV_KEYS) deleteEnvironmentValue(scrubbed, key)
  const appDir = appDirValue?.replace(/\/+$/u, '')
  if (!appDir) return scrubbed
  for (const key of APPIMAGE_PATH_LIKE_ENV_KEYS) {
    const value = readEnvironmentValue(scrubbed, key)
    if (value === undefined) continue
    const kept = value
      .split(':')
      .filter((segment) => segment.length > 0 && !isPathSegmentUnderAppDir(segment, appDir))
    deleteEnvironmentValue(scrubbed, key)
    if (kept.length > 0) scrubbed[key] = kept.join(':')
  }
  return scrubbed
}

function isPathSegmentUnderAppDir(segment: string, appDir: string) {
  return segment === appDir || segment.startsWith(`${appDir}/`)
}

function npmCompatiblePathDirs(platform: NodeJS.Platform) {
  if (platform === 'darwin') return MACOS_NPM_COMPATIBLE_PATH_DIRS
  if (platform === 'win32') return []
  return POSIX_NPM_COMPATIBLE_PATH_DIRS
}

function userToolPathDirs(platform: NodeJS.Platform, homeDir: string) {
  if (platform === 'win32') return []
  const pathSegments =
    platform === 'darwin'
      ? [...MACOS_USER_TOOL_PATH_SEGMENTS, ...POSIX_USER_TOOL_PATH_SEGMENTS]
      : POSIX_USER_TOOL_PATH_SEGMENTS
  return pathSegments.map((segments) => join(homeDir, ...segments))
}
