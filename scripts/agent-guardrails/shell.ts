/**
 * Turns the scanner's raw commands into the commands that actually run: drops `if`/`then`/`do`
 * and friends, splits off `NAME=value` prefixes, unwraps runners such as `env`, `sudo`, `timeout`,
 * `xargs` or `pnpm exec`, and reads the scripts that `bash -c`, `eval`, a here-document fed to a
 * shell, or `git rebase --exec` run. A script piped into a shell cannot be read, so it comes back
 * as `unreadable` and the rules block it instead of guessing.
 */
import { MAX_SHELL_NESTING, type RawCommand, scanShell } from './shell-scanner'

/** One command the shell runs. */
export interface ShellCommand {
  /** `NAME=value` words before the command, those after `env`, and `export NAME=value`. */
  readonly assignments: readonly string[]
  /** The command and its arguments with quotes removed. Empty for an assignment-only line. */
  readonly argv: readonly string[]
  /** Files its output redirections write. */
  readonly writes: readonly string[]
  /** Why the script this command runs cannot be read, when it cannot. */
  readonly unreadable?: string
}

interface Runner {
  /** Options that take the next word as their value. */
  readonly valueOptions: readonly string[]
  /** Operands to skip after the options before the command starts (`timeout 5 git ...`). */
  readonly operands: number
}

type InnerScript = { readonly script: string } | { readonly unreadable: string }

const RESERVED_WORDS = new Set([
  '{',
  '}',
  '!',
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'while',
  'until',
  'esac',
])
// Compound commands whose own words are data (`for x in a b`), not a command to run.
const DATA_COMMANDS = new Set(['for', 'case', 'select', 'function'])
const DECLARATIONS = new Set(['export', 'declare', 'typeset', 'readonly', 'local'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish'])
const SHELL_VALUE_OPTIONS = new Set(['--rcfile', '--init-file', '-o', '+o', '-O', '+O'])
const STDIN_SCRIPTS = new Set(['/dev/stdin', '/dev/fd/0', '-'])
const ASSIGNMENT = /^[A-Za-z_]\w*=/
const RUNNERS: ReadonlyMap<string, Runner> = new Map([
  ['env', { valueOptions: ['-u', '--unset', '-C', '--chdir'], operands: 0 }],
  ['sudo', { valueOptions: ['-u', '-g', '-p', '-C', '-D', '-U', '-r', '-t', '-h'], operands: 0 }],
  ['doas', { valueOptions: ['-u', '-C'], operands: 0 }],
  ['command', { valueOptions: [], operands: 0 }],
  ['builtin', { valueOptions: [], operands: 0 }],
  ['exec', { valueOptions: ['-a'], operands: 0 }],
  ['nohup', { valueOptions: [], operands: 0 }],
  ['time', { valueOptions: ['-f', '-o', '--format', '--output'], operands: 0 }],
  ['nice', { valueOptions: ['-n', '--adjustment'], operands: 0 }],
  ['ionice', { valueOptions: ['-c', '-n', '-p'], operands: 0 }],
  ['timeout', { valueOptions: ['-k', '-s', '--kill-after', '--signal'], operands: 1 }],
  ['gtimeout', { valueOptions: ['-k', '-s', '--kill-after', '--signal'], operands: 1 }],
  ['stdbuf', { valueOptions: ['-i', '-o', '-e'], operands: 0 }],
  [
    'xargs',
    {
      valueOptions: ['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '--delimiter', '--max-args'],
      operands: 0,
    },
  ],
  ['caffeinate', { valueOptions: ['-t', '-w'], operands: 0 }],
  ['npx', { valueOptions: ['-p', '--package'], operands: 0 }],
  ['bunx', { valueOptions: ['-p', '--package'], operands: 0 }],
])
// `pnpm exec git ...`, `bun x git ...` and `npm exec git ...` run `git ...`.
const SUBCOMMAND_RUNNERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['pnpm', new Set(['exec', 'dlx'])],
  ['bun', new Set(['x', 'exec'])],
  ['npm', new Set(['exec'])],
  ['yarn', new Set(['exec', 'dlx'])],
])
const SUBCOMMAND_RUNNER_WORDS = 2
// A short option and its attached value start after two characters: `-Svalue`, `-xcmd`.
const PAIR_LENGTH = 2

/** `git` for `git`, `/usr/bin/git` and `C:\\Program Files\\Git\\bin\\git.exe`. */
export function commandName(word: string) {
  const base = word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1)
  return base.toLowerCase().endsWith('.exe') ? base.slice(0, -'.exe'.length) : base
}

/** Every command the shell would run for `script`, including the scripts it runs. */
export function shellCommands(script: string, depth = 0): ShellCommand[] {
  if (depth > MAX_SHELL_NESTING) {
    return [
      { assignments: [], argv: [], writes: [], unreadable: 'a shell nested too deeply to read' },
    ]
  }
  return scanShell(script).flatMap((raw) => expand(raw, depth))
}

function expand(raw: RawCommand, depth: number): ShellCommand[] {
  const words = dropReservedWords(raw.words)
  if (DATA_COMMANDS.has(words[0] ?? '')) {
    return raw.writes.length > 0 ? [{ assignments: [], argv: [], writes: raw.writes }] : []
  }
  const command: ShellCommand = { ...unwrap(words), writes: raw.writes }
  const inner = innerScript(command.argv, raw)
  if (inner === undefined) {
    return [command]
  }
  if ('unreadable' in inner) {
    return [{ ...command, unreadable: inner.unreadable }]
  }
  return [command, ...shellCommands(inner.script, depth + 1)]
}

function dropReservedWords(words: readonly string[]) {
  const start = words.findIndex((word) => !RESERVED_WORDS.has(word))
  return start === -1 ? [] : words.slice(start)
}

function unwrap(words: readonly string[]): Pick<ShellCommand, 'assignments' | 'argv'> {
  const assignments: string[] = []
  let index = 0
  while (index < words.length) {
    const word = words[index] ?? ''
    if (ASSIGNMENT.test(word)) {
      assignments.push(word)
      index += 1
      continue
    }
    const name = commandName(word)
    if (DECLARATIONS.has(name)) {
      // `export HUSKY=0` sets the variable for every later command.
      assignments.push(...words.slice(index + 1).filter((arg) => ASSIGNMENT.test(arg)))
      return { assignments, argv: words.slice(index) }
    }
    if (SUBCOMMAND_RUNNERS.get(name)?.has(words[index + 1] ?? '') === true) {
      index += SUBCOMMAND_RUNNER_WORDS
      continue
    }
    const runner = RUNNERS.get(name)
    // `env -S` runs a string as a command line; `innerScript` reads it.
    if (
      runner === undefined ||
      (name === 'env' && envSplitScript(words.slice(index)) !== undefined)
    ) {
      break
    }
    index = skipRunnerOptions(words, index + 1, runner)
  }
  return { assignments, argv: words.slice(index) }
}

function skipRunnerOptions(words: readonly string[], start: number, runner: Runner) {
  let index = start
  while (index < words.length) {
    const word = words[index] ?? ''
    if (word === '--') {
      index += 1
      break
    }
    if (!word.startsWith('-') || word === '-') {
      break
    }
    index += 1 + Number(runner.valueOptions.includes(word))
  }
  return index + runner.operands
}

function innerScript(argv: readonly string[], raw: RawCommand): InnerScript | undefined {
  const name = commandName(argv[0] ?? '')
  if (name === 'eval') {
    return { script: argv.slice(1).join(' ') }
  }
  if (name === 'env') {
    return envSplitScript(argv)
  }
  if (name === 'git') {
    return rebaseExecScript(argv)
  }
  return SHELLS.has(name) ? shellScript(argv, raw) : undefined
}

/** `env -S 'git commit -n'` splits its string into a command. */
function envSplitScript(argv: readonly string[]): InnerScript | undefined {
  const split = argv.findIndex((arg) => arg === '-S' || arg === '--split-string')
  if (split !== -1) {
    return { script: argv.slice(split + 1).join(' ') }
  }
  const attached = argv.find(
    (arg) =>
      arg.startsWith('--split-string=') || (arg.startsWith('-S') && arg.length > PAIR_LENGTH),
  )
  if (attached === undefined) {
    return undefined
  }
  const value = attached.startsWith('--')
    ? attached.slice(attached.indexOf('=') + 1)
    : attached.slice(PAIR_LENGTH)
  return { script: [value, ...argv.slice(argv.indexOf(attached) + 1)].join(' ') }
}

/** The commands `git rebase -x <cmd>` or `--exec <cmd>` runs after each commit. */
function rebaseExecScript(argv: readonly string[]): InnerScript | undefined {
  const rebase = argv.indexOf('rebase')
  if (rebase === -1) {
    return undefined
  }
  const args = argv.slice(rebase + 1)
  const scripts = args.flatMap((arg, index) => {
    if (arg === '-x' || arg === '--exec') {
      return [args[index + 1] ?? '']
    }
    if (arg.startsWith('--exec=')) {
      return [arg.slice('--exec='.length)]
    }
    return arg.startsWith('-x') ? [arg.slice(PAIR_LENGTH)] : []
  })
  return scripts.length === 0 ? undefined : { script: scripts.join('\n') }
}

interface ShellOptions {
  readonly runsCommandString: boolean
  readonly readsStdin: boolean
  /** The index of the first operand: the command string, or the script file. */
  readonly operand: number
}

/** Reads `bash -euo pipefail -c ...`: which options are set and where the operands start. */
function readShellOptions(argv: readonly string[]): ShellOptions {
  let index = 1
  let flags = ''
  while (index < argv.length) {
    const option = argv[index] ?? ''
    if (option === '--' || option === '-') {
      index += 1
      break
    }
    if (!(option.startsWith('-') || option.startsWith('+'))) {
      break
    }
    const long = option.startsWith('--')
    flags += long ? '' : option.slice(1)
    // `-o pipefail` and `-euo pipefail` take the next word as a value.
    const takesValue = SHELL_VALUE_OPTIONS.has(option) || (!long && /[oO]$/.test(option))
    index += 1 + Number(takesValue)
  }
  return { runsCommandString: flags.includes('c'), readsStdin: flags.includes('s'), operand: index }
}

function shellScript(argv: readonly string[], raw: RawCommand): InnerScript | undefined {
  const options = readShellOptions(argv)
  if (options.runsCommandString) {
    return { script: argv[options.operand] ?? '' }
  }
  const scriptFile = argv[options.operand]
  if (!options.readsStdin && scriptFile !== undefined && !STDIN_SCRIPTS.has(scriptFile)) {
    return undefined
  }
  if (raw.stdin !== undefined) {
    return { script: raw.stdin }
  }
  return raw.piped ? { unreadable: `text piped into ${commandName(argv[0] ?? '')}` } : undefined
}
