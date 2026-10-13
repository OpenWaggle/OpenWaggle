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
  'all',
  'approve',
  'credential-stdin',
  'credential-store',
  'dry-run',
  'archived',
  'full',
  'full-transcript',
  'include-archived',
  'include-bodies',
  'include-queue-bodies',
  'json',
  'jsonl',
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
  'profile',
  'session',
  'stdio',
  'token-stdin',
  'workspace',
] as const

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
  const optionValue = inlineValue ?? (consumesNext ? (next ?? '') : 'true')
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
  return option(arguments_, name) === 'true'
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
  const missingValues = [...arguments_.options.entries()]
    .flatMap(([name, values]) =>
      !BOOLEAN_OPTIONS.has(name) && values.some((value) => value === 'true') ? [name] : [],
    )
    .sort()
  if (missingValues.length > 0) {
    throw new Error(`Missing value for ${missingValues.map((name) => `--${name}`).join(', ')}.`)
  }
  const valuedBooleans = [...arguments_.options.entries()]
    .flatMap(([name, values]) =>
      BOOLEAN_OPTIONS.has(name) && values.some((value) => value !== 'true') ? [name] : [],
    )
    .sort()
  if (valuedBooleans.length > 0) {
    throw new Error(`${valuedBooleans.map((name) => `--${name}`).join(', ')} do not accept values.`)
  }
  if (command === 'serve') serveAuthorizationCeiling(arguments_)
}

export function serveAuthorizationCeiling(arguments_: ParsedArguments): AgentAuthorizationMode {
  const value = option(arguments_, 'authorization-ceiling') ?? 'ask-for-approval'
  if (value === 'ask-for-approval' || value === 'yolo') return value
  throw new Error(
    `Unsupported MCP authorization ceiling ${JSON.stringify(value)}. Expected "ask-for-approval" or "yolo".`,
  )
}
