/**
 * The file changes that turn the git hooks off without touching a git flag:
 *
 * - Husky's generated `.husky/_` directory, which `core.hooksPath` points at, and husky's startup
 *   file `husky/init.sh` in `$XDG_CONFIG_HOME` or `~/.config`, which every hook sources (an
 *   `exit 0` there skips them all). Neither shows up in a diff, so review never sees them.
 * - git's own config files (`.git/config`, `config.worktree`), where `core.hooksPath` lives.
 * - Removing or moving away a tracked hook script, or `.husky` itself: husky exits 0 when the
 *   script is missing.
 * - Writing a tracked hook script from the shell. Agents change hook scripts with the edit and
 *   write tools, whose result is checked for an early `exit` (see `hookScriptDisabled`).
 */
import path from 'node:path'
import type { GuardrailHit } from './hits'
import { type ShellCommand, commandName } from './shell'
import { parseGitInvocation } from './args'

interface FileChanges {
  readonly written: readonly string[]
  readonly removed: readonly string[]
}

type ChangeReader = (args: readonly string[], operands: readonly string[]) => FileChanges

const NOTHING: FileChanges = { written: [], removed: [] }
const OCTAL_MODE = /^[0-7]{3,4}$/
// In `755` or `0755` the owner's digit is third from the end; an even digit has no exec bit.
const OWNER_DIGIT = -3
const NO_EXEC_DIGITS = new Set(['0', '2', '4', '6'])
const SHORT_CLUSTER = /^-[a-zA-Z]+$/
// A file's folder and name: the last two path segments.
const PARENT_AND_NAME = -2
const REGEX_SPECIALS = /[.+^$()|\\[\]]/g
const GIT_CONFIG_FILES = new Set(['config', 'config.worktree'])
// `sed -i`, `perl -pi -e`, `-i.bak`, `--in-place`.
const IN_PLACE_TOOLS = new Set(['sed', 'gsed', 'perl'])
const FIND_CHANGE_TOOLS = new Set([
  'rm',
  'rmdir',
  'unlink',
  'shred',
  'mv',
  'chmod',
  'truncate',
  'tee',
  'sed',
  'perl',
])

export const HOOK_FILES_HIT: GuardrailHit = {
  rule: 'hook-files',
  title:
    'Changing .husky/_, husky init.sh, or removing, moving or rewriting a hook script from the shell turns off the git hooks.',
}
export const GIT_CONFIG_FILE_HIT: GuardrailHit = {
  rule: 'git-config-file',
  title: 'Editing git config files directly can change core.hooksPath and turn off the git hooks.',
}

const writesAll: ChangeReader = (_args, operands) => ({ written: operands, removed: [] })
const removesAll: ChangeReader = (_args, operands) => ({ written: [], removed: operands })
const copies: ChangeReader = (args, operands) => ({
  written: [...operands.slice(-1), ...targetDirectory(args)],
  removed: [],
})

const READERS: ReadonlyMap<string, ChangeReader> = new Map<string, ChangeReader>([
  ['tee', writesAll],
  ['truncate', writesAll],
  ['rm', removesAll],
  ['rmdir', removesAll],
  ['unlink', removesAll],
  ['shred', removesAll],
  ['trash', removesAll],
  ['cp', copies],
  ['ln', copies],
  ['install', copies],
  ['rsync', copies],
  ['mv', moves],
  ['chmod', chmods],
  ['dd', dd],
  ['find', finds],
  ['git', gitFileChanges],
])

/** The hook-file rules one shell command breaks. */
export function hookFileHits(command: ShellCommand) {
  const args = command.argv.slice(1)
  const operands = args.filter((arg) => !arg.startsWith('-'))
  const name = commandName(command.argv[0] ?? '')
  const reader = IN_PLACE_TOOLS.has(name) ? inPlace : READERS.get(name)
  const changes = reader === undefined ? NOTHING : reader(args, operands)
  const written = [...command.writes, ...changes.written]
  const hits: GuardrailHit[] = []
  if ([...written, ...changes.removed].some(isGitConfigFile)) {
    hits.push(GIT_CONFIG_FILE_HIT)
  }
  if (
    written.some((file) => isHuskySwitch(file) || isHookScript(file)) ||
    changes.removed.some(isHookRemoval)
  ) {
    hits.push(HOOK_FILES_HIT)
  }
  return hits
}

/** The rule a `write` or `edit` tool call on `file` breaks, given the file's text afterwards. */
export function fileToolHits(file: string, resultingText: string | undefined) {
  if (isGitConfigFile(file)) {
    const hit: GuardrailHit[] = [GIT_CONFIG_FILE_HIT]
    return hit
  }
  if (isHuskySwitch(file)) {
    const hit: GuardrailHit[] = [HOOK_FILES_HIT]
    return hit
  }
  const hit: GuardrailHit[] =
    isHookScript(file) && resultingText !== undefined && hookScriptDisabled(resultingText)
      ? [{ rule: 'hook-files', title: `This change to ${file} makes the hook do nothing.` }]
      : []
  return hit
}

/**
 * True when a hook script runs nothing: no command at all, or a first command that exits or does
 * nothing (`exit`, `exit 0`, `true`, `:`), which skips everything after it.
 */
export function hookScriptDisabled(text: string) {
  const commands = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
  const first = commands[0]
  return (
    first === undefined ||
    /^(?:exit(?:\s+\d+)?|true|:|return(?:\s+\d+)?)\s*(?:[;#].*)?$/.test(first)
  )
}

/** `.husky/_` and husky's `init.sh`: writing or removing either can turn the hooks off. */
function isHuskySwitch(file: string) {
  const parts = segments(file)
  const [parent, name] = parts.slice(PARENT_AND_NAME)
  const isInit =
    parts.length > 1 && parent?.toLowerCase() === 'husky' && name?.toLowerCase() === 'init.sh'
  return (
    isInit || parts.some((part, index) => isHuskyDir(part) && matchesName(parts[index + 1], '_'))
  )
}

/** A tracked hook script: `.husky/<name>` where the name has no dot (`pre-push`, `commit-msg`). */
function isHookScript(file: string) {
  const parts = segments(file)
  const [parent = '', name = ''] = parts.slice(PARENT_AND_NAME)
  return parts.length > 1 && isHuskyDir(parent) && !name.includes('.') && !matchesName(name, '_')
}

function isHookRemoval(file: string) {
  return isHuskySwitch(file) || isHookScript(file) || isHuskyDir(segments(file).at(-1) ?? '')
}

function isGitConfigFile(file: string) {
  const parts = segments(file)
  const name = parts.at(-1) ?? ''
  return (
    parts.slice(0, -1).some((part) => matchesName(part, '.git')) &&
    [...GIT_CONFIG_FILES].some((config) => matchesName(name, config))
  )
}

function moves(args: readonly string[], operands: readonly string[]) {
  const target = targetDirectory(args)
  return target.length > 0
    ? { written: target, removed: operands }
    : { written: operands.slice(-1), removed: operands.slice(0, -1) }
}

function inPlace(args: readonly string[], operands: readonly string[]) {
  const edits = args.some(
    (arg) =>
      arg.startsWith('-i') ||
      arg.startsWith('--in-place') ||
      (SHORT_CLUSTER.test(arg) && arg.includes('i')),
  )
  const changes: FileChanges = edits ? { written: operands, removed: [] } : NOTHING
  return changes
}

// `chmod -x`, `a-x`, `u=rw` or an octal mode without the owner's exec bit can stop a hook from
// running; `+x` cannot. `-R` on `.husky` reaches `.husky/_`.
function chmods(args: readonly string[]) {
  const recursive = args.some((arg) => SHORT_CLUSTER.test(arg) && arg.includes('R'))
  const [mode = '', ...files] = args.filter((arg) => !SHORT_CLUSTER.test(arg) || arg.includes('x'))
  const octal = OCTAL_MODE.test(mode) && NO_EXEC_DIGITS.has(mode.at(OWNER_DIGIT) ?? '')
  const symbolic = mode.includes('-') || mode.includes('=')
  const reached = files.flatMap((file) => (recursive ? [file, `${file}/_`] : [file]))
  const changes: FileChanges = symbolic || octal ? { written: reached, removed: [] } : NOTHING
  return changes
}

function dd(args: readonly string[]) {
  const changes: FileChanges = {
    written: args.filter((arg) => arg.startsWith('of=')).map((arg) => arg.slice('of='.length)),
    removed: [],
  }
  return changes
}

function finds(args: readonly string[], operands: readonly string[]) {
  const changes =
    args.includes('-delete') ||
    args.some(
      (arg, index) =>
        (arg === '-exec' || arg === '-execdir') &&
        FIND_CHANGE_TOOLS.has(commandName(args[index + 1] ?? '')),
    )
  // Every operand counts, `-name .husky` included: it names what gets removed.
  const result: FileChanges = changes ? { written: [], removed: operands } : NOTHING
  return result
}

function gitFileChanges(args: readonly string[]) {
  const { subcommand, args: rest } = parseGitInvocation(args)
  const paths = rest.filter((arg) => !arg.startsWith('-'))
  if (subcommand === 'rm') {
    const changes: FileChanges = { written: [], removed: paths }
    return changes
  }
  if (subcommand === 'mv') {
    const changes: FileChanges = { written: paths.slice(-1), removed: paths.slice(0, -1) }
    return changes
  }
  if (subcommand === 'update-index' && rest.includes('--chmod=-x')) {
    const changes: FileChanges = { written: paths, removed: [] }
    return changes
  }
  const changes: FileChanges = subcommand === 'clean' ? gitClean(rest, paths) : NOTHING
  return changes
}

// `.husky/_/.gitignore` ignores everything in it, so `git clean -x` or `-X` removes `.husky/_`
// unless every pathspec is outside `.husky`.
function gitClean(rest: readonly string[], paths: readonly string[]) {
  const ignored = rest.some(
    (arg) => SHORT_CLUSTER.test(arg) && (arg.includes('x') || arg.includes('X')),
  )
  const reaches =
    paths.length === 0 ||
    paths.some((spec) => {
      const [first] = segments(spec)
      return first === undefined || isHuskyDir(first)
    })
  const changes: FileChanges = ignored && reaches ? { written: [], removed: ['.husky/_'] } : NOTHING
  return changes
}

function targetDirectory(args: readonly string[]) {
  return args.flatMap((arg, index) => {
    if (arg === '-t' || arg === '--target-directory') {
      return [args[index + 1] ?? '']
    }
    return arg.startsWith('--target-directory=') ? [arg.slice('--target-directory='.length)] : []
  })
}

// `a//b`, `a/./b`, `a\b` and a trailing `/` name the same file as `a/b`.
function segments(file: string) {
  return path.posix
    .normalize(file.replaceAll('\\', '/'))
    .split('/')
    .filter((part) => part !== '' && part !== '.')
}

// `.husky`, `.Husky` (macOS volumes ignore case) or a glob such as `.hus*`.
function isHuskyDir(part: string) {
  return matchesName(part, '.husky')
}

/** True when `part`, a name or a glob such as `*`, `.hus?` or `{_,x}`, can name `name`. */
function matchesName(part: string | undefined, name: string) {
  if (part === undefined) {
    return false
  }
  return expandBraces(part).some((alternative) => {
    // Like bash, `*` and `?` do not match a leading dot: `dist/*` never reaches `dist/.husky`.
    if (name.startsWith('.') && !alternative.startsWith('.')) {
      return false
    }
    const pattern = alternative
      .replaceAll(REGEX_SPECIALS, String.raw`\$&`)
      .replaceAll('*', '.*')
      .replaceAll('?', '.')
    return new RegExp(`^${pattern}$`, 'i').test(name)
  })
}

function expandBraces(glob: string): string[] {
  const open = glob.indexOf('{')
  const close = glob.indexOf('}', open)
  if (open === -1 || close === -1) {
    return [glob]
  }
  const before = glob.slice(0, open)
  const after = glob.slice(close + 1)
  return glob
    .slice(open + 1, close)
    .split(',')
    .flatMap((alternative) => expandBraces(before + alternative + after))
}
