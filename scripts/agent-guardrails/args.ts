/**
 * A small getopt for the guardrail rules: splits one command's arguments into short flags, long
 * flags, option values and positionals, so a commit message (`-m "drop the -n flag"`) is a value
 * and never reads as a flag.
 */

export interface OptionSpec {
  /** Short flags that take a value, attached (`-mfoo`) or as the next word (`-m foo`). */
  readonly valueShort: string
  /** Short flags whose value can only be attached (`-uno`, `-Skey`); they end a flag cluster. */
  readonly attachedShort: string
  /** Long options that take the next word as their value when no `=value` is attached. */
  readonly valueLong: readonly string[]
}

export interface ParsedArgs {
  readonly short: ReadonlySet<string>
  /** Long options as written, without their `=value`. */
  readonly long: readonly string[]
  readonly positionals: readonly string[]
}

/** git's global options that take the next word as their value (`git -C /repo push`). */
const GIT_GLOBAL_VALUE_OPTIONS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
  '--attr-source',
  '--exec-path',
  '--list-cmds',
])

export interface GitInvocation {
  /** `-c key=value` and `--config-env key=ENV` settings, as `key=value`. */
  readonly configs: readonly string[]
  readonly subcommand: string
  readonly args: readonly string[]
}

/** Splits `git [global options] <subcommand> [args]`. */
export function parseGitInvocation(args: readonly string[]): GitInvocation {
  const configs: string[] = []
  let index = 0
  while ((args[index] ?? '').startsWith('-')) {
    const [name, attached] = splitLong(args[index] ?? '')
    const takesNext = GIT_GLOBAL_VALUE_OPTIONS.has(name) && attached === undefined
    const value = takesNext ? args[index + 1] : attached
    if ((name === '-c' || name === '--config-env') && value !== undefined) {
      configs.push(value)
    }
    // `-ccore.hooksPath=x` attaches the value to `-c`.
    if (name.startsWith('-c') && name.length > '-c'.length && !name.startsWith('--')) {
      configs.push(name.slice('-c'.length))
    }
    index += 1 + Number(takesNext)
  }
  const [subcommand = '', ...rest] = args.slice(index)
  return { configs, subcommand, args: rest }
}

export function parseArgs(args: readonly string[], spec: OptionSpec): ParsedArgs {
  const short = new Set<string>()
  const long: string[] = []
  const positionals: string[] = []
  let index = 0
  while (index < args.length) {
    const arg = args[index] ?? ''
    index += 1
    if (arg === '--') {
      positionals.push(...args.slice(index))
      break
    }
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg)
      continue
    }
    if (arg.startsWith('--')) {
      const [name, attached] = splitLong(arg)
      long.push(name)
      index += Number(attached === undefined && spec.valueLong.includes(name))
      continue
    }
    index += Number(readShortCluster(arg, spec, short))
  }
  return { short, long, positionals }
}

/** Reads `-abc` into `short`; true when its last flag takes the next word as its value. */
function readShortCluster(cluster: string, spec: OptionSpec, short: Set<string>) {
  for (let position = 1; position < cluster.length; position += 1) {
    const flag = cluster.charAt(position)
    short.add(flag)
    if (spec.valueShort.includes(flag)) {
      return position === cluster.length - 1
    }
    if (spec.attachedShort.includes(flag)) {
      return false
    }
  }
  return false
}

/** `--name=value` as `['--name', 'value']`; any other word with no value. */
export function splitLong(arg: string): [string, string | undefined] {
  const equals = arg.indexOf('=')
  return arg.startsWith('--') && equals !== -1
    ? [arg.slice(0, equals), arg.slice(equals + 1)]
    : [arg, undefined]
}

export function isHelp(parsed: ParsedArgs) {
  return parsed.short.has('h') || parsed.long.includes('--help')
}

/**
 * True when `flag` is `option` or a prefix of it at least `shortest` characters long. git accepts
 * any unambiguous prefix of a long option, and rejects an ambiguous one, so matching every prefix
 * past the ambiguous ones never blocks a command git would run differently.
 */
export function isAbbreviation(flag: string, option: string, shortest: number) {
  return flag.length >= shortest && option.startsWith(flag)
}
