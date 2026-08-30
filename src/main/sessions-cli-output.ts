const JSON_INDENT_SPACES = 2
export const SESSIONS_CLI_OUTPUT_SCHEMA_VERSION = 1 as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function humanLabel(value: string) {
  return value.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function humanOutcome(value: unknown) {
  if (!isRecord(value) || !isRecord(value.response) || !isRecord(value.response.outcome)) {
    return JSON.stringify(value, null, JSON_INDENT_SPACES)
  }
  const outcome = value.response.outcome
  const title =
    typeof outcome.effect === 'string'
      ? humanLabel(outcome.effect)
      : typeof outcome.operation === 'string'
        ? humanLabel(outcome.operation)
        : 'Session Result'
  const details = Object.entries(outcome)
    .filter(([key]) => key !== 'effect' && key !== 'operation')
    .map(([key, entry]) => {
      const formatted =
        typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'
          ? String(entry)
          : JSON.stringify(entry, null, JSON_INDENT_SPACES)
      return `${humanLabel(key)}: ${formatted}`
    })
  return [title, ...details].join('\n')
}

export function writeSessionsCliResponse(command: string, value: unknown, json: boolean) {
  const output = json
    ? JSON.stringify(
        {
          schemaVersion: SESSIONS_CLI_OUTPUT_SCHEMA_VERSION,
          type: 'response',
          command,
          result: value,
        },
        null,
        JSON_INDENT_SPACES,
      )
    : humanOutcome(value)
  process.stdout.write(`${output}\n`)
}

export function writeSessionsCliStreamRecord(record: unknown, jsonl: boolean) {
  const output = jsonl
    ? JSON.stringify({
        schemaVersion: SESSIONS_CLI_OUTPUT_SCHEMA_VERSION,
        type: 'record',
        record,
      })
    : humanOutcome(record)
  process.stdout.write(`${output}\n`)
}

export type SessionsCliErrorKind =
  | 'usage'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'conflict'
  | 'timeout'
  | 'host_unavailable'
  | 'internal'

function includesAny(message: string, fragments: readonly string[]) {
  return fragments.some((fragment) => message.includes(fragment))
}

export function classifySessionsCliError(error: unknown): SessionsCliErrorKind {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (
    includesAny(message, [
      'required',
      'exactly one',
      'does not accept',
      'unknown option',
      'unsupported option',
      'unsupported',
      'must be',
      'choose either',
      'commands use',
    ])
  )
    return 'usage'
  if (includesAny(message, ['authentication', 'credential'])) return 'authentication'
  if (includesAny(message, ['authoriz', 'capability'])) return 'authorization'
  if (includesAny(message, ['not found', 'missing'])) return 'not_found'
  if (includesAny(message, ['conflict', 'changed'])) return 'conflict'
  if (includesAny(message, ['timed out', 'timeout'])) return 'timeout'
  if (includesAny(message, ['host', 'econn', 'socket'])) {
    return 'host_unavailable'
  }
  return 'internal'
}

export function writeSessionsCliError(error: unknown, machine: boolean) {
  const kind = classifySessionsCliError(error)
  const message = error instanceof Error ? error.message : String(error)
  const output = machine
    ? JSON.stringify({
        schemaVersion: SESSIONS_CLI_OUTPUT_SCHEMA_VERSION,
        type: 'error',
        error: { kind, message },
      })
    : `error [${kind}]: ${message}`
  process.stderr.write(`${output}\n`)
  return kind
}

export function validateSessionsCliOutputMode(input: {
  readonly json: boolean
  readonly jsonl: boolean
  readonly stream: boolean
}) {
  if (input.json && input.jsonl) throw new Error('Choose either --json or --jsonl, not both.')
  if (input.stream && input.json) throw new Error('Streaming commands use --jsonl, not --json.')
  if (!input.stream && input.jsonl)
    throw new Error('Single-response commands use --json, not --jsonl.')
}
