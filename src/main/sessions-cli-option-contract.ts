import type { ParsedArguments } from './mcp-cli-arguments'
import { validateSessionsCliCombinations } from './sessions-cli-option-combinations'
import { validateSessionsCliPositionals } from './sessions-cli-positional-contract'

const CLIENT_OPTIONS = ['profile', 'credential-stdin', 'profile-credential-file'] as const
const OUTPUT_OPTIONS = ['json', 'jsonl'] as const
const MESSAGE_INPUT_OPTIONS = ['text', 'stdin', 'input-file', 'request-json'] as const
const IDEMPOTENCY = ['idempotency-key'] as const

const DIRECT_COMMAND_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  help: [],
  create: [
    'title',
    'workspace',
    'workspace-id',
    'base-ref',
    'start-from-origin',
    'agent',
    'model',
    'thinking',
    ...IDEMPOTENCY,
  ],
  launch: [
    ...MESSAGE_INPUT_OPTIONS,
    'attach',
    'title',
    'workspace',
    'workspace-id',
    'base-ref',
    'start-from-origin',
    'agent',
    'model',
    'thinking',
    'authorization',
    'yolo',
    'interaction-timeout-ms',
    ...IDEMPOTENCY,
  ],
  fork: [
    'workspace',
    'workspace-id',
    'base-ref',
    'start-from-origin',
    'target-node',
    'position',
    'title',
    ...IDEMPOTENCY,
  ],
  spawn: [
    ...MESSAGE_INPUT_OPTIONS,
    'attach',
    'expected-run',
    'workspace',
    'base-ref',
    'start-from-origin',
    'agent',
    'model',
    'thinking',
    'authorization',
    'yolo',
    'interaction-timeout-ms',
    'deliverable',
    'accept',
    'resource',
    ...IDEMPOTENCY,
  ],
  message: [...MESSAGE_INPUT_OPTIONS, 'attach', 'thinking', ...IDEMPOTENCY],
  start: [
    ...MESSAGE_INPUT_OPTIONS,
    'attach',
    'thinking',
    'authorization',
    'yolo',
    'interaction-timeout-ms',
    ...IDEMPOTENCY,
  ],
  'follow-up': [
    ...MESSAGE_INPUT_OPTIONS,
    'attach',
    'thinking',
    'authorization',
    'yolo',
    ...IDEMPOTENCY,
  ],
  steer: [...MESSAGE_INPUT_OPTIONS, 'attach', 'expected-run', ...IDEMPOTENCY],
  replace: [
    ...MESSAGE_INPUT_OPTIONS,
    'attach',
    'expected-run',
    'thinking',
    'authorization',
    'yolo',
    ...IDEMPOTENCY,
  ],
  interrupt: ['expected-run', ...IDEMPOTENCY],
  'interrupt-descendants': [...IDEMPOTENCY],
  rename: [...IDEMPOTENCY],
  archive: [...IDEMPOTENCY],
  unarchive: [...IDEMPOTENCY],
  handoff: ['workspace', 'workspace-id', 'base-ref', 'start-from-origin', ...IDEMPOTENCY],
  promote: ['expected-run', ...IDEMPOTENCY],
  report: [
    ...MESSAGE_INPUT_OPTIONS,
    'source-run',
    'upstream',
    'queen',
    'target',
    'worker',
    'request-reply',
    'reply-to',
    ...IDEMPOTENCY,
  ],
  list: ['project', 'all', 'archived', 'limit', 'cursor'],
  search: [
    'project',
    'all',
    'limit',
    'cursor',
    'include-archived',
    'full-transcript',
    'mode',
    'require-fresh',
    'timeout-ms',
  ],
  read: ['full', 'scope', 'branch'],
  turns: ['limit', 'cursor'],
  items: ['run', 'scope', 'branch', 'after', 'through', 'snapshot-head', 'limit'],
  status: [],
  watch: ['after-host', 'after-sequence'],
  wait: [
    'condition',
    'after-state-revision',
    'report-id',
    'correlation-id',
    'timeout-ms',
    'after-host',
    'after-sequence',
  ],
}

const GROUPED_COMMAND_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  'authorization:set': [...IDEMPOTENCY],
  'authorization:clear': [...IDEMPOTENCY],
  'queue:list': ['include-bodies'],
  'queue:withdraw': [...IDEMPOTENCY],
  'queue:reorder': ['queue-revision', ...IDEMPOTENCY],
  'queue:pause': ['queue-revision', ...IDEMPOTENCY],
  'queue:resume': ['queue-revision', ...IDEMPOTENCY],
  'queue:update-authorization': ['authorization', ...IDEMPOTENCY],
  'requests:list': [],
  'requests:respond': ['response-json', 'approve', ...IDEMPOTENCY],
  'delegation:submit': ['evidence-json', ...IDEMPOTENCY],
  'delegation:state': [...IDEMPOTENCY],
  'delegation:claim': ['claim-json', ...IDEMPOTENCY],
  'delegation:acknowledge-conflict': [...IDEMPOTENCY],
  'delegation:dependency': [...IDEMPOTENCY],
  'delegation:propose-amendment': ['specification-json', ...IDEMPOTENCY],
  'delegation:amend': ['specification-json', 'proposal', ...IDEMPOTENCY],
  'delegation:request-revision': [
    'revised-objective',
    'deliverable',
    'accept',
    'resource',
    ...IDEMPOTENCY,
  ],
  'delegation:accept': [...IDEMPOTENCY],
  'delegation:reopen': [...IDEMPOTENCY],
  'delegation:cancel': [...IDEMPOTENCY],
  'delegation:verify': ['evidence-json', ...IDEMPOTENCY],
  'export:stream': ['format', 'scope', 'branch', 'include-queue-bodies', 'limit'],
  'export:create': [
    'format',
    'scope',
    'branch',
    'include-queue-bodies',
    'resource',
    'overwrite',
    ...IDEMPOTENCY,
  ],
  'export:cancel': [...IDEMPOTENCY],
  'export:list': ['status', 'limit', 'cursor', 'include-queue-bodies'],
  'export:read': ['include-queue-bodies'],
  'export:wait': ['timeout-ms', 'after-host', 'after-sequence', 'include-queue-bodies'],
  'export:watch': ['after-host', 'after-sequence'],
}

const ALL_SESSION_OPTIONS: ReadonlySet<string> = new Set([
  ...Object.values(DIRECT_COMMAND_OPTIONS).flat(),
  ...Object.values(GROUPED_COMMAND_OPTIONS).flat(),
  ...CLIENT_OPTIONS,
  ...OUTPUT_OPTIONS,
])

const EXPORT_ACTIONS = new Set(['create', 'cancel', 'list', 'read', 'wait', 'watch'])
const BOOLEAN_OPTIONS = new Set([
  'all',
  'approve',
  'archived',
  'credential-stdin',
  'full',
  'full-transcript',
  'include-archived',
  'include-bodies',
  'include-queue-bodies',
  'json',
  'jsonl',
  'overwrite',
  'queen',
  'request-reply',
  'require-fresh',
  'start-from-origin',
  'stdin',
  'upstream',
  'yolo',
])

function commandRoute(command: string, arguments_: ParsedArguments) {
  if (command === 'export') {
    const action = arguments_.positionals[0]
    return `export:${action && EXPORT_ACTIONS.has(action) ? action : 'stream'}`
  }
  if (command === 'authorization' || command === 'queue' || command === 'requests') {
    return `${command}:${arguments_.positionals[0] ?? ''}`
  }
  if (command === 'delegation') return `delegation:${arguments_.positionals[0] ?? ''}`
  return command
}

function allowedOptions(route: string) {
  const specific = DIRECT_COMMAND_OPTIONS[route] ?? GROUPED_COMMAND_OPTIONS[route]
  if (!specific) throw new Error(`Unsupported Sessions command: ${route}.`)
  return new Set([...specific, ...CLIENT_OPTIONS, ...OUTPUT_OPTIONS])
}

function validateOptionValues(arguments_: ParsedArguments) {
  const missing = [...arguments_.options.entries()].flatMap(([name, values]) =>
    !BOOLEAN_OPTIONS.has(name) && values.some((value) => value === 'true') ? [name] : [],
  )
  if (missing.length > 0) {
    throw new Error(
      `Missing value for ${missing
        .sort()
        .map((name) => `--${name}`)
        .join(', ')}.`,
    )
  }
  const valuedBooleans = [...arguments_.options.entries()]
    .flatMap(([name, values]) =>
      BOOLEAN_OPTIONS.has(name) && values.some((value) => value !== 'true') ? [name] : [],
    )
    .sort()
  if (valuedBooleans.length > 0) {
    throw new Error(`${valuedBooleans.map((name) => `--${name}`).join(', ')} do not accept values.`)
  }
}

export function validateSessionsCliOptions(command: string, arguments_: ParsedArguments) {
  const route = commandRoute(command, arguments_)
  const allowed = allowedOptions(route)
  const unknown = [...arguments_.options.keys()]
    .filter((name) => !ALL_SESSION_OPTIONS.has(name))
    .sort()
  if (unknown.length > 0) {
    throw new Error(
      `Unknown option${unknown.length === 1 ? '' : 's'} for OpenWaggle Sessions: ${unknown
        .map((name) => `--${name}`)
        .join(', ')}.`,
    )
  }
  const unsupported = [...arguments_.options.keys()].filter((name) => !allowed.has(name)).sort()
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported option${unsupported.length === 1 ? '' : 's'} for sessions ${route.replace(':', ' ')}: ${unsupported
        .map((name) => `--${name}`)
        .join(', ')}.`,
    )
  }
  validateOptionValues(arguments_)
  validateSessionsCliCombinations(command, arguments_)
  validateSessionsCliPositionals(route, arguments_)
}
