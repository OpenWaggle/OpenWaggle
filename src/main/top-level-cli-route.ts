import path from 'node:path'

/** Command groups owned by an existing `*-cli-entry.ts` module. */
const TOP_LEVEL_CLI_GROUPS = [
  'sessions',
  'delegations',
  'agents',
  'access',
  'mcp',
  'update',
  'recovery',
] as const

type TopLevelCliGroup = (typeof TOP_LEVEL_CLI_GROUPS)[number]

/** Commands implemented by the top-level CLI itself. */
const TOP_LEVEL_CLI_COMMANDS = ['run', 'status', 'host'] as const

export type TopLevelCliCommand = (typeof TOP_LEVEL_CLI_COMMANDS)[number]

/** The detached Session Host launch command. Never advertised or suggested. */
const INTERNAL_COMMANDS = new Set(['session-host-internal'])

const HELP_TOKENS = new Set(['help', '-h', '--help'])
const VERSION_TOKENS = new Set(['version', '-v', '-V', '--version'])
const HELP_FLAGS = new Set(['-h', '--help'])

/** Sessions subcommands a user may type without the `sessions` group. */
const SESSIONS_SUBCOMMAND_HINTS = new Set([
  'archive',
  'create',
  'export',
  'fork',
  'launch',
  'list',
  'message',
  'read',
  'search',
  'spawn',
  'steer',
  'wait',
  'watch',
])

/** Legacy macOS process serial number argument added by some launchers. */
const MACOS_PROCESS_SERIAL_NUMBER_PREFIX = '-psn_'
const LONG_OPTION_PREFIX = '--'
/** macOS user-defaults overrides such as `open -a OpenWaggle --args -AppleLanguages '(de)'`. */
const MACOS_DEFAULTS_OVERRIDE = /^-(?:Apple|NS)[A-Za-z]+$/

const SHORT_WORD_LENGTH = 4
const SHORT_WORD_MAX_DISTANCE = 1
const LONG_WORD_MAX_DISTANCE = 2
const MINIMUM_PREFIX_LENGTH = 3
const TRANSPOSITION_SPAN = 2
const HOME_PREFIXES = ['~/', '~\\'] as const
const OPTION_VALUE_SEPARATOR = '='
/** Chromium's verbose-logging switch is `--v=<level>`; a bare `--v` is a mistyped version flag. */
const SHORT_LONG_OPTION_TYPOS: Readonly<Record<string, string>> = {
  '--h': '--help',
  '--v': '--version',
}
const TOP_LEVEL_OPTIONS = ['--help', '--version'] as const
const GROUP_HELP_FLAG_ARGUMENT_COUNT = 2

export type CliPathKind = 'directory' | 'file' | 'missing'

export interface TopLevelCliEnvironment {
  readonly workingDirectory: string
  readonly homeDirectory: string
  readonly pathKind: (absolutePath: string) => CliPathKind
  /**
   * Packaged builds are launched by people and desktop shells, never with an app path, so a
   * bare word after an unknown switch can only be a mistake. Development launches put the app
   * path after automation switches (`electron --inspect=0 .`).
   */
  readonly isPackaged: boolean
}

export type TopLevelCliRoute =
  | { readonly kind: 'gui' }
  | { readonly kind: 'open-project'; readonly projectPath: string }
  | { readonly kind: 'delegate'; readonly argv: readonly string[] }
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | {
      readonly kind: 'command'
      readonly command: TopLevelCliCommand
      readonly argv: readonly string[]
    }
  | { readonly kind: 'usage-error'; readonly message: string }

function isGroup(value: string): value is TopLevelCliGroup {
  return TOP_LEVEL_CLI_GROUPS.some((group) => group === value)
}

function isCommand(value: string): value is TopLevelCliCommand {
  return TOP_LEVEL_CLI_COMMANDS.some((command) => command === value)
}

function isAdjacentTransposition(left: string, right: string, row: number, column: number) {
  return (
    row >= TRANSPOSITION_SPAN &&
    column >= TRANSPOSITION_SPAN &&
    left[row - 1] === right[column - TRANSPOSITION_SPAN] &&
    left[row - TRANSPOSITION_SPAN] === right[column - 1]
  )
}

/** Optimal string alignment distance: Levenshtein plus adjacent transposition. */
export function editDistance(left: string, right: string) {
  // Rows are kept as a rolling window of the last three rows needed for transpositions.
  let beforePrevious: number[] = []
  let previous = Array.from({ length: right.length + 1 }, (_, column) => column)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      const substitution =
        (previous[column - 1] ?? 0) + (left[row - 1] === right[column - 1] ? 0 : 1)
      const best = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        substitution,
      )
      current[column] = isAdjacentTransposition(left, right, row, column)
        ? Math.min(best, (beforePrevious[column - TRANSPOSITION_SPAN] ?? 0) + 1)
        : best
    }
    beforePrevious = previous
    previous = current
  }
  return previous[right.length] ?? Number.POSITIVE_INFINITY
}

function maximumDistance(value: string) {
  return value.length <= SHORT_WORD_LENGTH ? SHORT_WORD_MAX_DISTANCE : LONG_WORD_MAX_DISTANCE
}

/** The closest advertised command for a mistyped word, if one is close enough. */
export function suggestTopLevelCommand(value: string) {
  const lowered = value.toLowerCase()
  const candidates = [...TOP_LEVEL_CLI_GROUPS, ...TOP_LEVEL_CLI_COMMANDS, 'help', 'version']
  const prefixMatches = candidates.filter(
    (candidate) => lowered.length >= MINIMUM_PREFIX_LENGTH && candidate.startsWith(lowered),
  )
  if (prefixMatches.length === 1) return prefixMatches[0]
  let best: { readonly candidate: string; readonly distance: number } | null = null
  for (const candidate of candidates) {
    const distance = editDistance(lowered, candidate)
    if (distance > maximumDistance(candidate)) continue
    if (!best || distance < best.distance) best = { candidate, distance }
  }
  return best?.candidate
}

function suggestOption(name: string) {
  const lowered = name.toLowerCase()
  const shortTypo = SHORT_LONG_OPTION_TYPOS[lowered]
  if (shortTypo) return shortTypo
  return TOP_LEVEL_OPTIONS.find(
    (candidate) => name !== candidate && editDistance(lowered, candidate) <= LONG_WORD_MAX_DISTANCE,
  )
}

function looksLikePath(value: string) {
  return (
    value === '.' ||
    value === '..' ||
    value === '~' ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    HOME_PREFIXES.some((prefix) => value.startsWith(prefix)) ||
    value.includes('/') ||
    value.includes('\\') ||
    path.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value)
  )
}

function resolveUserPath(value: string, environment: TopLevelCliEnvironment) {
  if (value === '~') return environment.homeDirectory
  const prefix = HOME_PREFIXES.find((candidate) => value.startsWith(candidate))
  if (prefix) return path.join(environment.homeDirectory, value.slice(prefix.length))
  return path.resolve(environment.workingDirectory, value)
}

function unknownCommand(value: string) {
  const suggestion = suggestTopLevelCommand(value)
  if (suggestion) return `unknown command '${value}'. Did you mean '${suggestion}'?`
  if (SESSIONS_SUBCOMMAND_HINTS.has(value)) {
    return `unknown command '${value}'. Did you mean 'sessions ${value}'?`
  }
  return `unknown command '${value}'.`
}

function routeHelp(argv: readonly string[]): TopLevelCliRoute {
  const [, topic, ...rest] = argv
  if (topic === undefined) return { kind: 'help' }
  if (rest.length > 0) return { kind: 'usage-error', message: 'help accepts one command name.' }
  if (isGroup(topic)) return { kind: 'delegate', argv: groupHelpArgv(topic) }
  if (isCommand(topic)) return { kind: 'command', command: topic, argv: ['--help'] }
  if (HELP_TOKENS.has(topic) || VERSION_TOKENS.has(topic)) return { kind: 'help' }
  return { kind: 'usage-error', message: `no help topic '${topic}'.` }
}

function groupHelpArgv(group: TopLevelCliGroup) {
  // `update` reports usage through its --help flag, and `access` when run without a command.
  if (group === 'update') return [group, '--help']
  if (group === 'access') return [group]
  return [group, 'help']
}

function routeGroup(group: TopLevelCliGroup, argv: readonly string[]): TopLevelCliRoute {
  // Only the exact `<group> -h|--help` form is rewritten, so message payloads that happen
  // to contain a help flag are never reinterpreted.
  const onlyArgument = argv.length === GROUP_HELP_FLAG_ARGUMENT_COUNT ? argv[1] : undefined
  if (onlyArgument !== undefined && HELP_FLAGS.has(onlyArgument)) {
    return { kind: 'delegate', argv: groupHelpArgv(group) }
  }
  return { kind: 'delegate', argv }
}

function routeLongOption(
  first: string,
  argv: readonly string[],
  environment: TopLevelCliEnvironment,
): TopLevelCliRoute {
  const separator = first.indexOf(OPTION_VALUE_SEPARATOR)
  const name = separator === -1 ? first : first.slice(0, separator)
  if (separator !== -1 && TOP_LEVEL_OPTIONS.some((option) => option === name)) {
    return { kind: 'usage-error', message: `${name} does not accept a value.` }
  }
  // `--status` and the like are commands written as switches; no Electron switch has those names.
  const commandName = name.slice(LONG_OPTION_PREFIX.length)
  if (separator === -1 && (isGroup(commandName) || isCommand(commandName))) {
    return {
      kind: 'usage-error',
      message: `unknown option '${first}'. Did you mean '${commandName}'?`,
    }
  }
  const suggestion = separator === -1 || name !== '--v' ? suggestOption(name) : undefined
  if (suggestion) {
    return {
      kind: 'usage-error',
      message: `unknown option '${first}'. Did you mean '${suggestion}'?`,
    }
  }
  const stray = argv.slice(1).find((token) => !token.startsWith('-'))
  if (environment.isPackaged && stray !== undefined) {
    return { kind: 'usage-error', message: `unknown option '${first}' before '${stray}'.` }
  }
  // Long switches configure Electron and Chromium (automation, CDP, sandboxing, updater
  // relaunches, and the app's own launch markers); they have always started the desktop app.
  return { kind: 'gui' }
}

function routeOption(
  first: string,
  argv: readonly string[],
  environment: TopLevelCliEnvironment,
): TopLevelCliRoute {
  if (first === '--') {
    return { kind: 'usage-error', message: "unexpected '--' before a command." }
  }
  if (first.startsWith('--')) return routeLongOption(first, argv, environment)
  if (first.startsWith(MACOS_PROCESS_SERIAL_NUMBER_PREFIX)) return { kind: 'gui' }
  if (MACOS_DEFAULTS_OVERRIDE.test(first)) return { kind: 'gui' }
  return { kind: 'usage-error', message: `unknown option '${first}'.` }
}

function routeWord(
  first: string,
  argv: readonly string[],
  environment: TopLevelCliEnvironment,
): TopLevelCliRoute {
  const candidatePath = resolveUserPath(first, environment)
  const kind = environment.pathKind(candidatePath)
  if (kind === 'directory') {
    if (argv.length > 1) {
      return {
        kind: 'usage-error',
        message: `unexpected argument '${argv[1] ?? ''}' after project path '${first}'.`,
      }
    }
    return { kind: 'open-project', projectPath: candidatePath }
  }
  if (kind === 'file') {
    // A file named on the command line opens its folder. (macOS delivers files dropped on
    // the app icon as `open-file` events, not arguments.)
    if (argv.length > 1) {
      return {
        kind: 'usage-error',
        message: `unexpected argument '${argv[1] ?? ''}' after '${first}'.`,
      }
    }
    return { kind: 'open-project', projectPath: path.dirname(candidatePath) }
  }
  if (looksLikePath(first)) {
    return { kind: 'usage-error', message: `no such directory: '${first}'.` }
  }
  return { kind: 'usage-error', message: unknownCommand(first) }
}

/**
 * Decide what one OpenWaggle invocation does. Only the first application argument selects
 * a route: later tokens belong to the selected command and are never scanned.
 */
export function routeTopLevelCli(
  argv: readonly string[],
  environment: TopLevelCliEnvironment,
): TopLevelCliRoute {
  const [first] = argv
  if (first === undefined) return { kind: 'gui' }
  // `openwaggle "$UNSET"` must not quietly open the working directory.
  if (first.trim() === '') return { kind: 'usage-error', message: 'empty argument.' }
  if (INTERNAL_COMMANDS.has(first)) return { kind: 'delegate', argv }
  if (isGroup(first)) return routeGroup(first, argv)
  if (isCommand(first)) return { kind: 'command', command: first, argv: argv.slice(1) }
  if (HELP_TOKENS.has(first)) return routeHelp(argv)
  if (VERSION_TOKENS.has(first)) {
    return argv.length === 1
      ? { kind: 'version' }
      : { kind: 'usage-error', message: `${first} does not accept arguments.` }
  }
  if (first.startsWith('-')) return routeOption(first, argv, environment)
  return routeWord(first, argv, environment)
}
