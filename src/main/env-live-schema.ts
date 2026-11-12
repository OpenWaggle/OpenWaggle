import { decodeUnknownOrThrow, Schema, type SchemaType } from '@shared/schema'

/**
 * The variables main-process code reads by name, out of `process.env` when they are used rather
 * than at startup (desktop-shell hydration and `withTemporaryProcessEnv` change it while the app
 * runs, so `readLiveEnv` decodes the current environment each time) or out of an environment map
 * built for a child process ({@link environmentVariables}).
 */
export const liveEnvSchema = Schema.Struct({
  PATH: Schema.optional(Schema.String),
  /** Windows spellings of PATH, in a map that is not case-insensitive like `process.env`. */
  Path: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  LC_CTYPE: Schema.optional(Schema.String),
  XDG_CACHE_HOME: Schema.optional(Schema.String),
  APPIMAGE: Schema.optional(Schema.String),
  OPENWAGGLE_HOST_TMPDIR: Schema.optional(Schema.String),
  OPENWAGGLE_LOG_LEVEL: Schema.optional(Schema.String),
  OPENWAGGLE_USER_DATA_DIR: Schema.optional(Schema.String),
  OPENWAGGLE_CLI_OUTPUT_FD: Schema.optional(Schema.String),
  OPENWAGGLE_DISABLE_COMPILE_CACHE: Schema.optional(Schema.String),
  OPENWAGGLE_COMPILE_CACHE_DIR: Schema.optional(Schema.String),
  HOME: Schema.optional(Schema.String),
  SHELL: Schema.optional(Schema.String),
  TERM: Schema.optional(Schema.String),
  LANG: Schema.optional(Schema.String),
  LC_ALL: Schema.optional(Schema.String),
  USER: Schema.optional(Schema.String),
  USERNAME: Schema.optional(Schema.String),
  TMPDIR: Schema.optional(Schema.String),
  TEMP: Schema.optional(Schema.String),
  TMP: Schema.optional(Schema.String),
  SystemRoot: Schema.optional(Schema.String),
  WINDIR: Schema.optional(Schema.String),
  USERPROFILE: Schema.optional(Schema.String),
  APPDATA: Schema.optional(Schema.String),
  LOCALAPPDATA: Schema.optional(Schema.String),
  DBUS_SESSION_BUS_ADDRESS: Schema.optional(Schema.String),
  DISPLAY: Schema.optional(Schema.String),
  WAYLAND_DISPLAY: Schema.optional(Schema.String),
  XDG_RUNTIME_DIR: Schema.optional(Schema.String),
  /** Where Pi keeps its agent directory, when it is not `~/.pi/agent`. */
  PI_CODING_AGENT_DIR: Schema.optional(Schema.String),
})

export type LiveEnv = SchemaType<typeof liveEnvSchema>

/** The variables {@link liveEnvSchema} names, decoded from an environment map. */
export function environmentVariables(
  environment: Readonly<Partial<Record<string, string>>>,
): LiveEnv {
  return decodeUnknownOrThrow(liveEnvSchema, environment)
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
