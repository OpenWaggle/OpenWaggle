import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { decodeUnknownOrThrow, Schema, type SchemaType } from '@shared/schema'

const optionalUrlSchema = Schema.optional(
  Schema.String.pipe(
    Schema.filter((value) => {
      try {
        // URL constructor normalizes and validates the shape for us.
        new URL(value)
        return true
      } catch {
        return 'Must be a valid URL.'
      }
    }),
  ),
)

const envSchema = Schema.Struct({
  ELECTRON_RENDERER_URL: optionalUrlSchema,
  OPENWAGGLE_AUTOMATION: Schema.optional(Schema.Literal('1')),
  OPENWAGGLE_AUTOMATION_LEASE_TOKEN: Schema.optional(Schema.String),
  OPENWAGGLE_AUTOMATION_PROJECT_PATH: Schema.optional(Schema.String),
  OPENWAGGLE_USER_DATA_DIR: Schema.optional(Schema.String),
  OPENWAGGLE_DISABLE_SINGLE_INSTANCE: Schema.optional(Schema.String),
  OPENWAGGLE_LOG_LEVEL: Schema.optional(Schema.Literal('debug', 'info', 'warn', 'error')),
})

export type Env = SchemaType<typeof envSchema>

export const env: Env = decodeUnknownOrThrow(envSchema, process.env)

export const logLevel = env.OPENWAGGLE_LOG_LEVEL ?? 'info'

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

let temporaryProcessEnvQueue: Promise<void> = Promise.resolve()

/**
 * Safe environment for child processes.
 * Only passes through essential variables — prevents leaking API keys,
 * secrets, or other sensitive values from the parent process.
 */
export function getSafeChildEnv(): Record<string, string | undefined> {
  return {
    PATH: getNpmCompatiblePath(),
    HOME: process.env.HOME,
    SHELL: process.env.SHELL,
    TERM: process.env.TERM,
    LANG: process.env.LANG,
    USER: process.env.USER,
    TMPDIR: process.env.TMPDIR,
  }
}

/**
 * Environment for source-control CLI calls.
 * Strips provider token variables so gh/glab use their keyring-stored credentials for the exact
 * host selected by the validated Git remote. Inherited tokens from CI or developer tooling can
 * silently select a different identity or be disclosed to an attacker-controlled custom host.
 */
export function getSourceControlCliEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: getNpmCompatiblePath(),
  }
  delete env.GITHUB_TOKEN
  delete env.GH_TOKEN
  delete env.GITHUB_ENTERPRISE_TOKEN
  delete env.GH_ENTERPRISE_TOKEN
  delete env.GITLAB_TOKEN
  delete env.GITLAB_ACCESS_TOKEN
  delete env.GITLAB_PRIVATE_TOKEN
  delete env.OAUTH_TOKEN
  delete env.CI_JOB_TOKEN
  // Repository/host selection is supplied explicitly on every gh/glab invocation. Ambient
  // overrides would otherwise be able to retarget a command despite the validated Git remote.
  delete env.GH_REPO
  delete env.GH_HOST
  delete env.GITLAB_REPO
  delete env.GITLAB_HOST
  delete env.GITLAB_API_HOST
  delete env.GITLAB_SSH_HOST
  delete env.GITLAB_HEAD_REPO
  delete env.GITLAB_URI
  delete env.GITLAB_URL
  delete env.GLAB_REPO
  delete env.GLAB_HOST
  return env
}

/**
 * The current environment plus explicit overrides, for child git invocations that
 * need extra variables (e.g. `GIT_INDEX_FILE` for a scratch index) while still
 * inheriting PATH/HOME. `env.ts` is the only module allowed to read process.env.
 */
export function getEnvWithOverrides(
  overrides: Readonly<Record<string, string>>,
): Record<string, string | undefined> {
  return { ...process.env, ...overrides }
}

export function getNpmCompatiblePath(): string {
  const result: string[] = []
  const seen = new Set<string>()

  function addPath(value: string | undefined) {
    if (!value || seen.has(value)) {
      return
    }
    seen.add(value)
    result.push(value)
  }

  // Preserve user PATH precedence; extra directories are fallbacks for GUI-launched apps.
  for (const value of (process.env.PATH ?? '').split(delimiter)) {
    addPath(value)
  }

  for (const value of getUserToolPathDirs()) {
    addPath(value)
  }

  for (const value of getNpmCompatiblePathDirs()) {
    addPath(value)
  }

  return result.join(delimiter)
}

function getNpmCompatiblePathDirs() {
  if (process.platform === 'darwin') {
    return MACOS_NPM_COMPATIBLE_PATH_DIRS
  }
  if (process.platform === 'win32') {
    return []
  }
  return POSIX_NPM_COMPATIBLE_PATH_DIRS
}

function getUserToolPathDirs() {
  if (process.platform === 'win32') {
    return []
  }

  const homeDir = homedir()
  const pathSegments =
    process.platform === 'darwin'
      ? [...MACOS_USER_TOOL_PATH_SEGMENTS, ...POSIX_USER_TOOL_PATH_SEGMENTS]
      : POSIX_USER_TOOL_PATH_SEGMENTS
  return pathSegments.map((segments) => join(homeDir, ...segments))
}

export async function withNpmCompatibleProcessEnv<T>(operation: () => Promise<T>): Promise<T> {
  return withTemporaryProcessEnv({ PATH: getNpmCompatiblePath() }, operation)
}

export async function withTemporaryProcessEnv<T>(
  overrides: Readonly<Record<string, string>>,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireTemporaryProcessEnvLock()
  const previousValues = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key])
    process.env[key] = value
  }

  try {
    return await operation()
  } finally {
    for (const [key, previousValue] of previousValues) {
      if (previousValue === undefined) {
        delete process.env[key]
        continue
      }
      process.env[key] = previousValue
    }
    release()
  }
}

async function acquireTemporaryProcessEnvLock() {
  const previous = temporaryProcessEnvQueue
  let releaseCurrent: (() => void) | undefined
  temporaryProcessEnvQueue = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  await previous
  return () => releaseCurrent?.()
}
