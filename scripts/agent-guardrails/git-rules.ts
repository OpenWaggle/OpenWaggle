/**
 * The git rules, read from one command's argv and environment: skipping a hook (`--no-verify`,
 * `git commit -n`, `HUSKY=0`, pointing `core.hooksPath` elsewhere by any route) and force pushes.
 * Both are blocked without a prompt. An alias is read as the command it stands for, so `git -c
 * alias.p='push --force' p` is a force push.
 */
import { type OptionSpec, isAbbreviation, isHelp, parseArgs, parseGitInvocation } from './args'
import type { GuardrailHit } from './hits'
import { type ShellCommand, commandName, shellCommands } from './shell'

const HOOKS_PATH_KEY = 'core.hookspath'
/** The value husky itself sets; writing it turns the hooks back on. */
const HUSKY_HOOKS_PATH = '.husky/_'
const COMMIT_OPTIONS: OptionSpec = {
  valueShort: 'mCcFt',
  attachedShort: 'uS',
  valueLong: [
    '--message',
    '--file',
    '--template',
    '--author',
    '--date',
    '--cleanup',
    '--reuse-message',
    '--reedit-message',
    '--fixup',
    '--squash',
    '--trailer',
    '--pathspec-from-file',
  ],
}
const PUSH_OPTIONS: OptionSpec = {
  valueShort: 'o',
  attachedShort: '',
  valueLong: ['--repo', '--receive-pack', '--exec', '--push-option'],
}
const MERGE_OPTIONS: OptionSpec = {
  valueShort: 'mFsXx',
  attachedShort: 'S',
  valueLong: [
    '--message',
    '--file',
    '--strategy',
    '--strategy-option',
    '--into-name',
    '--exec',
    '--onto',
    '--depth',
  ],
}
const CONFIG_OPTIONS: OptionSpec = {
  valueShort: 'f',
  attachedShort: '',
  valueLong: ['--file', '--blob', '--type', '--default', '--comment', '--value'],
}
// Subcommands that run commit or push hooks and accept `--no-verify`.
const NO_VERIFY_SUBCOMMANDS = new Set([
  'push',
  'merge',
  'pull',
  'rebase',
  'am',
  'cherry-pick',
  'revert',
])
const CONFIG_VERBS = new Set([
  'get',
  'set',
  'unset',
  'list',
  'edit',
  'rename-section',
  'remove-section',
])
const CONFIG_WRITE_FLAGS = new Set([
  '--unset',
  '--unset-all',
  '--add',
  '--replace-all',
  '--rename-section',
  '--remove-section',
])
const ENV_CONFIG_KEY = /^GIT_CONFIG_KEY_\d+=(.*)$/
const ENV_CONFIG_PARAMETERS_PREFIX = 'GIT_CONFIG_PARAMETERS='
// `--no-ve` is the shortest prefix of `--no-verify` git could take; shorter ones are ambiguous.
const NO_VERIFY_SHORTEST = '--no-ve'.length
const FORCE_WITH_LEASE_SHORTEST = '--force-w'.length
const MIRROR_SHORTEST = '--mi'.length
const DRY_RUN_SHORTEST = '--d'.length
// An alias that stands for another alias is read this many levels deep at most.
const MAX_ALIAS_DEPTH = 3

const HUSKY_OFF: GuardrailHit = { rule: 'husky-off', title: 'HUSKY=0 turns off the git hooks.' }
const HOOKS_PATH: GuardrailHit = {
  rule: 'hooks-path',
  title: 'Changing or overriding core.hooksPath turns off the git hooks.',
}

/** Every git rule one command breaks. */
export function gitRuleHits(command: ShellCommand, aliasDepth = 0) {
  const hit: GuardrailHit[] = [
    ...environmentHits(command.assignments),
    ...(commandName(command.argv[0] ?? '') === 'git'
      ? gitHits(command.argv.slice(1), aliasDepth)
      : []),
  ]
  return hit
}

function environmentHits(assignments: readonly string[]) {
  const hits: GuardrailHit[] = []
  if (assignments.includes('HUSKY=0')) {
    hits.push(HUSKY_OFF)
  }
  // `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=x` sets config from
  // the environment; GIT_CONFIG_PARAMETERS is the list `git -c` passes to child processes.
  const setsHooksPath = assignments.some((assignment) => {
    const key = ENV_CONFIG_KEY.exec(assignment)?.[1]
    if (key !== undefined) {
      return key.toLowerCase() === HOOKS_PATH_KEY
    }
    return (
      assignment.startsWith(ENV_CONFIG_PARAMETERS_PREFIX) &&
      assignment.toLowerCase().includes(HOOKS_PATH_KEY)
    )
  })
  if (setsHooksPath) {
    hits.push(HOOKS_PATH)
  }
  return hits
}

function gitHits(args: readonly string[], aliasDepth: number) {
  const invocation = parseGitInvocation(args)
  const configHits = invocation.configs.flatMap((setting) => {
    const [key = '', ...valueParts] = setting.split('=')
    return settingHits(key, valueParts.join('='), aliasDepth)
  })
  const hit: GuardrailHit[] = [
    ...configHits,
    ...subcommandHits(invocation.subcommand, invocation.args, aliasDepth),
  ]
  return hit
}

function subcommandHits(subcommand: string, args: readonly string[], aliasDepth: number) {
  if (subcommand === 'commit') {
    return commitHits(args) satisfies GuardrailHit[]
  }
  if (subcommand === 'config') {
    return configHits(args, aliasDepth)
  }
  if (!NO_VERIFY_SUBCOMMANDS.has(subcommand)) {
    return [] satisfies GuardrailHit[]
  }
  const parsed = parseArgs(args, subcommand === 'push' ? PUSH_OPTIONS : MERGE_OPTIONS)
  if (isHelp(parsed)) {
    return [] satisfies GuardrailHit[]
  }
  const noVerify: GuardrailHit[] = parsed.long.some(isNoVerify)
    ? [{ rule: 'git-no-verify', title: `git ${subcommand} --no-verify skips the git hooks.` }]
    : []
  return (
    subcommand === 'push'
      ? [...noVerify, ...forcePushHits(parsed.short, parsed.long, parsed.positionals)]
      : noVerify
  ) satisfies GuardrailHit[]
}

function commitHits(args: readonly string[]) {
  const parsed = parseArgs(args, COMMIT_OPTIONS)
  if (isHelp(parsed) || !(parsed.short.has('n') || parsed.long.some(isNoVerify))) {
    return [] satisfies GuardrailHit[]
  }
  return [
    { rule: 'git-no-verify', title: 'git commit --no-verify (or -n) skips the commit hooks.' },
  ] satisfies GuardrailHit[]
}

function forcePushHits(
  short: ReadonlySet<string>,
  long: readonly string[],
  positionals: readonly string[],
) {
  // A dry run pushes nothing, so it rewrites nothing.
  if (short.has('n') || long.some((flag) => isAbbreviation(flag, '--dry-run', DRY_RUN_SHORTEST))) {
    const hit: GuardrailHit[] = []
    return hit
  }
  const refspecs = positionals.slice(1)
  const forced =
    short.has('f') ||
    long.includes('--force') ||
    long.some(
      (flag) =>
        isAbbreviation(flag, '--force-with-lease', FORCE_WITH_LEASE_SHORTEST) ||
        isAbbreviation(flag, '--mirror', MIRROR_SHORTEST),
    ) ||
    refspecs.some((spec) => spec.startsWith('+'))
  const hit: GuardrailHit[] = forced
    ? [
        {
          rule: 'force-push',
          title: 'A force push (--force, --force-with-lease, --mirror or a +refspec).',
        },
      ]
    : []
  return hit
}

interface ConfigCall {
  readonly key: string
  readonly value: string
  readonly opensEditor: boolean
  readonly unsets: boolean
  readonly writes: boolean
}

/** What a `git config` call does: which key, and whether it writes, unsets or opens an editor. */
function readConfigCall(args: readonly string[]) {
  const parsed = parseArgs(args, CONFIG_OPTIONS)
  const [first = '', ...rest] = parsed.positionals
  const verb = CONFIG_VERBS.has(first) ? first : undefined
  const [key = '', ...values] = verb === undefined ? parsed.positionals : rest
  const flags = parsed.long
  const opensEditor = verb === 'edit' || parsed.short.has('e') || flags.includes('--edit')
  const unsets = verb === 'unset' || flags.some((flag) => flag.startsWith('--unset'))
  const writesFlag = flags.some((flag) => CONFIG_WRITE_FLAGS.has(flag))
  const implicitSet = verb === undefined && !readsConfig(flags) && values.length > 0
  return {
    key,
    value: values.at(-1) ?? '',
    opensEditor,
    unsets,
    writes: verb === 'set' || opensEditor || unsets || writesFlag || implicitSet,
  } satisfies ConfigCall
}

/** `--get`, `--get-all`, `--get-regexp` and `--list` read; `git config get` is handled by verb. */
function readsConfig(flags: readonly string[]) {
  return flags.some((flag) => flag.startsWith('--get') || flag === '--list')
}

function configHits(args: readonly string[], aliasDepth: number) {
  const call = readConfigCall(args)
  if (!call.writes) {
    return [] satisfies GuardrailHit[]
  }
  // `git config --edit` opens the whole file, hooksPath included.
  if (call.opensEditor || (call.unsets && call.key.toLowerCase() === HOOKS_PATH_KEY)) {
    return [HOOKS_PATH] satisfies GuardrailHit[]
  }
  return settingHits(call.key, call.value, aliasDepth)
}

/** A `key=value` set through `git -c`, `git config` or the environment. */
function settingHits(key: string, value: string, aliasDepth: number) {
  const lowered = key.toLowerCase()
  if (lowered === HOOKS_PATH_KEY) {
    const hit: GuardrailHit[] = value === HUSKY_HOOKS_PATH ? [] : [HOOKS_PATH]
    return hit
  }
  if (!lowered.startsWith('alias.') || aliasDepth >= MAX_ALIAS_DEPTH) {
    const hit: GuardrailHit[] = []
    return hit
  }
  // `!cmd` aliases run a shell command; the others are git arguments.
  const script = value.startsWith('!') ? value.slice(1) : `git ${value}`
  const hit: GuardrailHit[] = shellCommands(script).flatMap((command) =>
    gitRuleHits(command, aliasDepth + 1),
  )
  return hit
}

function isNoVerify(flag: string) {
  return isAbbreviation(flag, '--no-verify', NO_VERIFY_SHORTEST)
}
