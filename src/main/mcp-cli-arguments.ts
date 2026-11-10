import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { validateMcpCliPositionals } from './mcp-cli-positional-contract'

export { formatMcpCliOutput, readSecretFromStdin } from './mcp-cli-io'
export { requireServeScope } from './mcp-cli-serve-scope'

const [NEXT_ARGUMENT_OFFSET, OPTION_AND_VALUE_COUNT] = [1, 2] as const

export interface ParsedArguments {
  readonly positionals: readonly string[]
  readonly passthrough: readonly string[]
  readonly options: ReadonlyMap<string, readonly string[]>
}

const BOOLEAN_OPTIONS = new Set([
  'acknowledge',
  'all',
  'approve',
  'confirm',
  'decline',
  'dismiss',
  'manage-all',
  'no-acceptance-criteria',
  'no-deliverables',
  'no-dependencies',
  'no-handoff',
  'no-resources',
  'credential-stdin',
  'credential-store',
  'dry-run',
  'archived',
  'finite',
  'full',
  'full-transcript',
  'include-archived',
  'include-bodies',
  'include-queue-bodies',
  'include-revoked',
  'indefinite',
  'json',
  'jsonl',
  'owner',
  'replace',
  'request-reply',
  'require-fresh',
  'stdio',
  'stdin',
  'token-stdin',
  'start-from-origin',
  'upstream',
  'queen',
  'yes',
  'yolo',
])

const HELP_OPTIONS = ['json'] as const
const SERVE_OPTIONS = [
  'authorization-ceiling',
  'grant',
  'export-root',
  'attachment-root',
  'http',
  'origin-session',
  'owner',
  'profile',
  'profile-credential-file',
  'session',
  'stdio',
  'token-stdin',
  'workspace',
] as const

/**
 * What the parser records for an option given without a value. No command-line argument can hold
 * a NUL character, so this never collides with a typed value, and `--choice true` stays a choice.
 */
const OPTION_WITHOUT_VALUE = '\u0000'

/** Whether a recorded option value means the option was given without one. */
export function isOptionWithoutValue(value: string) {
  return value === OPTION_WITHOUT_VALUE
}

/** Whether a recorded value fits a boolean flag: no value, or the explicit `true` of `--flag=true`. */
export function isFlagValue(value: string) {
  return value === 'true' || value === OPTION_WITHOUT_VALUE
}

/**
 * The usage error for options given the wrong kind of value, or null: a valued option with no
 * value, or a boolean option given one. Names are sorted so the message is stable.
 */
export function optionValueProblem(
  arguments_: ParsedArguments,
  booleanOptions: ReadonlySet<string>,
): string | null {
  const missingValues = [...arguments_.options.entries()]
    .flatMap(([name, values]) =>
      !booleanOptions.has(name) && values.some(isOptionWithoutValue) ? [name] : [],
    )
    .sort()
  if (missingValues.length > 0) {
    return `Missing value for ${missingValues.map((name) => `--${name}`).join(', ')}.`
  }
  const valuedBooleans = [...arguments_.options.entries()]
    .flatMap(([name, values]) =>
      booleanOptions.has(name) && values.some((value) => !isFlagValue(value)) ? [name] : [],
    )
    .sort()
  if (valuedBooleans.length > 0) {
    return `${valuedBooleans.map((name) => `--${name}`).join(', ')} do not accept values.`
  }
  return null
}

function parseOption(args: readonly string[], index: number, options: Map<string, string[]>) {
  const value = args[index] ?? ''
  const separator = value.indexOf('=')
  const key = value.slice(OPTION_AND_VALUE_COUNT, separator > 0 ? separator : undefined)
  const inlineValue = separator > 0 ? value.slice(separator + NEXT_ARGUMENT_OFFSET) : undefined
  const next = args[index + NEXT_ARGUMENT_OFFSET]
  const consumesNext =
    inlineValue === undefined &&
    !BOOLEAN_OPTIONS.has(key) &&
    Boolean(next) &&
    !next?.startsWith('--')
  const optionValue =
    inlineValue ??
    (consumesNext ? (next ?? '') : BOOLEAN_OPTIONS.has(key) ? 'true' : OPTION_WITHOUT_VALUE)
  options.set(key, [...(options.get(key) ?? []), optionValue])
  return consumesNext ? OPTION_AND_VALUE_COUNT : NEXT_ARGUMENT_OFFSET
}

export function parseMcpCliArguments(args: readonly string[]): ParsedArguments {
  const positionals: string[] = []
  const passthrough: string[] = []
  const options = new Map<string, string[]>()
  let index = 0
  while (index < args.length) {
    const value = args[index]
    if (value === '--') {
      passthrough.push(...args.slice(index + NEXT_ARGUMENT_OFFSET))
      break
    }
    if (!value?.startsWith('--')) {
      if (value !== undefined) positionals.push(value)
      index += NEXT_ARGUMENT_OFFSET
      continue
    }
    index += parseOption(args, index, options)
  }
  return { positionals, passthrough, options }
}

export function option(arguments_: ParsedArguments, name: string) {
  return arguments_.options.get(name)?.at(-1)
}

export function hasFlag(arguments_: ParsedArguments, name: string) {
  const value = option(arguments_, name)
  return value !== undefined && isFlagValue(value)
}

export function validateMcpCliOptions(command: string, arguments_: ParsedArguments) {
  validateMcpCliPositionals(command, arguments_)
  const allowed = command === 'serve' ? SERVE_OPTIONS : command === 'help' ? HELP_OPTIONS : null
  if (!allowed) throw new Error(`Unsupported MCP command: ${command}.`)
  const allowedSet = new Set<string>(allowed)
  const unknown = [...arguments_.options.keys()].filter((name) => !allowedSet.has(name)).sort()
  if (unknown.length > 0) {
    throw new Error(
      `Unknown option${unknown.length === 1 ? '' : 's'}: ${unknown.map((name) => `--${name}`).join(', ')}.`,
    )
  }
  const valueProblem = optionValueProblem(arguments_, BOOLEAN_OPTIONS)
  if (valueProblem !== null) throw new Error(valueProblem)
  if (command === 'serve') serveAuthorizationCeiling(arguments_)
}

export function serveAuthorizationCeiling(arguments_: ParsedArguments): AgentAuthorizationMode {
  const value = option(arguments_, 'authorization-ceiling') ?? 'ask-for-approval'
  if (value === 'ask-for-approval' || value === 'yolo') return value
  throw new Error(
    `Unsupported MCP authorization ceiling ${JSON.stringify(value)}. Expected "ask-for-approval" or "yolo".`,
  )
}
