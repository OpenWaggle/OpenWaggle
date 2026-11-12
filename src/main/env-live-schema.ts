import { decodeUnknownOrThrow, Schema, type SchemaType } from '@shared/schema'

// explicit undefined: a child-process env map (NodeJS.ProcessEnv) may set a variable to undefined
const variable = Schema.optional(Schema.String)

/**
 * The variables main-process code reads by name, out of `process.env` when they are used rather
 * than at startup (desktop-shell hydration and `withTemporaryProcessEnv` change it while the app
 * runs, so `readLiveEnv` decodes the current environment each time) or out of an environment map
 * built for a child process ({@link environmentVariables}).
 */
export const liveEnvSchema = Schema.Struct({
  PATH: variable,
  /** Windows spellings of PATH, in a map that is not case-insensitive like `process.env`. */
  Path: variable,
  path: variable,
  LC_CTYPE: variable,
  XDG_CACHE_HOME: variable,
  APPIMAGE: variable,
  OPENWAGGLE_HOST_TMPDIR: variable,
  OPENWAGGLE_LOG_LEVEL: variable,
  OPENWAGGLE_USER_DATA_DIR: variable,
  OPENWAGGLE_CLI_OUTPUT_FD: variable,
  OPENWAGGLE_DISABLE_COMPILE_CACHE: variable,
  OPENWAGGLE_COMPILE_CACHE_DIR: variable,
  HOME: variable,
  SHELL: variable,
  TERM: variable,
  LANG: variable,
  LC_ALL: variable,
  USER: variable,
  USERNAME: variable,
  TMPDIR: variable,
  TEMP: variable,
  TMP: variable,
  SystemRoot: variable,
  WINDIR: variable,
  USERPROFILE: variable,
  APPDATA: variable,
  LOCALAPPDATA: variable,
  DBUS_SESSION_BUS_ADDRESS: variable,
  DISPLAY: variable,
  WAYLAND_DISPLAY: variable,
  XDG_RUNTIME_DIR: variable,
  /** Where Pi keeps its agent directory, when it is not `~/.pi/agent`. */
  PI_CODING_AGENT_DIR: variable,
})

export type LiveEnv = SchemaType<typeof liveEnvSchema>

/** The variables {@link liveEnvSchema} names, decoded from an environment map. */
export function environmentVariables(environment: Readonly<Partial<Record<string, string>>>) {
  const env: LiveEnv = decodeUnknownOrThrow(liveEnvSchema, environment)
  return env
}

/**
 * Provider token variables, then the repository and host overrides. Repository/host selection is
 * supplied explicitly on every gh/glab invocation, so ambient overrides would otherwise be able to
 * retarget a command despite the validated Git remote.
 */
export const SOURCE_CONTROL_CLI_STRIPPED_VARIABLES = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITLAB_TOKEN',
  'GITLAB_ACCESS_TOKEN',
  'GITLAB_PRIVATE_TOKEN',
  'OAUTH_TOKEN',
  'CI_JOB_TOKEN',
  'GH_REPO',
  'GH_HOST',
  'GITLAB_REPO',
  'GITLAB_HOST',
  'GITLAB_API_HOST',
  'GITLAB_SSH_HOST',
  'GITLAB_HEAD_REPO',
  'GITLAB_URI',
  'GITLAB_URL',
  'GLAB_REPO',
  'GLAB_HOST',
] as const
