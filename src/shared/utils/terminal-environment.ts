const BLOCKED_TERMINAL_ENVIRONMENT_NAMES = new Set([
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

const PROJECT_ACTION_CONTEXT_ENVIRONMENT_NAMES = new Set([
  'OPENWAGGLE_PROJECT_ROOT',
  'OPENWAGGLE_WORKTREE_PATH',
  'T3CODE_PROJECT_ROOT',
  'T3CODE_WORKTREE_PATH',
])

const TERMINAL_ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u

export function isAllowedTerminalEnvironmentName(name: string) {
  return (
    TERMINAL_ENVIRONMENT_NAME_PATTERN.test(name) &&
    !BLOCKED_TERMINAL_ENVIRONMENT_NAMES.has(name.toUpperCase())
  )
}

function compareEnvironmentNames(
  left: readonly [string, string],
  right: readonly [string, string],
) {
  if (left[0] < right[0]) return -1
  if (left[0] > right[0]) return 1
  return 0
}

/** Canonical key ordering keeps launch-context equality independent of insertion order. */
export function normalizeTerminalEnvironment(
  environment: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(environment).sort(compareEnvironmentNames))
}

export function terminalEnvironmentsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
) {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every(([key, value]) => right[key] === value)
}

/**
 * Fixed action context wins over caller-provided values. Omitting a worktree
 * removes stale worktree variables instead of leaking them into Local mode.
 */
export function createProjectActionTerminalEnvironment(input: {
  readonly projectRoot: string
  readonly worktreePath?: string
  readonly overrides?: Readonly<Record<string, string>>
}) {
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(input.overrides ?? {})) {
    if (!PROJECT_ACTION_CONTEXT_ENVIRONMENT_NAMES.has(name.toUpperCase())) {
      environment[name] = value
    }
  }
  environment.T3CODE_PROJECT_ROOT = input.projectRoot
  environment.OPENWAGGLE_PROJECT_ROOT = input.projectRoot
  if (input.worktreePath !== undefined) {
    environment.T3CODE_WORKTREE_PATH = input.worktreePath
    environment.OPENWAGGLE_WORKTREE_PATH = input.worktreePath
  }
  return normalizeTerminalEnvironment(environment)
}
