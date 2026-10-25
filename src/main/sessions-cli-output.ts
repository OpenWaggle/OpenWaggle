import { CliError, type CliErrorKind } from './cli-error'
import { writeCliStdout } from './cli-stdout'
import {
  LocalSessionClientProtocolError,
  LocalSessionClientTimeoutError,
  LocalSessionHostUnavailableError,
  LocalSessionHostUpgradePendingError,
} from './session-host/local-session-client-protocol-error'

const JSON_INDENT_SPACES = 2
export const SESSIONS_CLI_OUTPUT_SCHEMA_VERSION = 1 as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function humanLabel(value: string) {
  return value.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

/**
 * Fields whose raw value misleads a person: a `running` queue is one that is not paused, even
 * when no Run is active (#351). `--json` keeps the raw values.
 */
const HUMAN_FIELDS: Readonly<
  Record<string, { readonly label: string; readonly value: (entry: unknown) => string | undefined }>
> = {
  queueState: {
    label: 'Follow-up Queue',
    value: (entry) =>
      entry === 'running' ? 'not paused' : entry === 'paused' ? 'paused' : undefined,
  },
  activeRunId: {
    label: 'Active Run',
    value: (entry) => (entry === null ? 'none (idle)' : undefined),
  },
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
      const readable = HUMAN_FIELDS[key]
      const formatted =
        readable?.value(entry) ??
        (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'
          ? String(entry)
          : JSON.stringify(entry, null, JSON_INDENT_SPACES))
      return `${readable?.label ?? humanLabel(key)}: ${formatted}`
    })
  return [title, ...details].join('\n')
}

export function writeSessionsCliResponse(command: string, value: unknown, json: boolean) {
  return writeCliStdout(sessionsCliResponseText(command, value, json))
}

/** The text `writeSessionsCliResponse` writes, for commands with their own stdout writer. */
export function sessionsCliResponseText(command: string, value: unknown, json: boolean) {
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
  return `${output}\n`
}

/** One versioned JSONL stream line, including its trailing newline. */
export function sessionsCliStreamRecordLine(record: unknown) {
  return `${JSON.stringify({ schemaVersion: SESSIONS_CLI_OUTPUT_SCHEMA_VERSION, type: 'record', record })}\n`
}

export function writeSessionsCliStreamRecord(record: unknown, jsonl: boolean) {
  return writeCliStdout(jsonl ? sessionsCliStreamRecordLine(record) : `${humanOutcome(record)}\n`)
}

export type SessionsCliErrorKind = CliErrorKind

const KIND_OF_CODE: ReadonlyMap<string, SessionsCliErrorKind> = new Map([
  ['authentication_failed', 'authentication'],
  ['credential_rejected', 'authentication'],
  ['profile_revoked', 'authentication'],
  ['host_draining', 'host_unavailable'],
  // A Session whose Pi file cannot be used is refused until the file is back or a message
  // starts a new transcript.
  ['pi_session_file_unusable', 'conflict'],
  // A worktree Session whose worktree is gone is refused until it is recreated.
  ['session_worktree_missing', 'conflict'],
])

export function sessionsCliErrorKindForCode(code: string): SessionsCliErrorKind | undefined {
  const normalized = code.toLowerCase()
  const exact = KIND_OF_CODE.get(normalized)
  if (exact) return exact
  if (normalized.includes('not_found') || normalized.includes('missing')) return 'not_found'
  if (
    normalized.includes('authoriz') ||
    normalized.includes('capability') ||
    normalized.includes('denied') ||
    normalized.includes('target_scope')
  ) {
    return 'authorization'
  }
  if (normalized.includes('timeout')) return 'timeout'
  if (normalized.includes('host_stopped') || normalized.includes('host_lost')) {
    return 'host_unavailable'
  }
  if (normalized.endsWith('_failed')) return 'internal'
  return undefined
}

/** A socket that could not reach the Session Host endpoint: a Node error from `connect`. */
function isHostConnectionError(error: unknown) {
  return (
    error instanceof Error &&
    Reflect.get(error, 'syscall') === 'connect' &&
    typeof Reflect.get(error, 'code') === 'string'
  )
}

/**
 * The kind of a CLI error, from its type alone (#351). An error without a known type is
 * `internal`: the commands raise their usage errors as typed errors, so an unexpected failure
 * never passes for a usage mistake because of how it is worded.
 */
export function classifySessionsCliError(error: unknown): SessionsCliErrorKind {
  if (error instanceof CliError) return error.kind
  if (error instanceof LocalSessionClientProtocolError) {
    return sessionsCliErrorKindForCode(error.code) ?? 'internal'
  }
  if (error instanceof LocalSessionClientTimeoutError) return 'timeout'
  if (
    error instanceof LocalSessionHostUnavailableError ||
    error instanceof LocalSessionHostUpgradePendingError ||
    isHostConnectionError(error)
  ) {
    return 'host_unavailable'
  }
  return 'internal'
}

/**
 * Every CLI reports a failure the same way (#351): `error [<kind>]: <message>` for people, and
 * `{schemaVersion, type: "error", error: {kind, message}}` with `--json` or `--jsonl`.
 */
export function writeSessionsCliError(
  error: unknown,
  machine: boolean,
  stderr: (value: string) => unknown = (value) => process.stderr.write(value),
) {
  const kind = classifySessionsCliError(error)
  const message = error instanceof Error ? error.message : String(error)
  const output = machine
    ? JSON.stringify({
        schemaVersion: SESSIONS_CLI_OUTPUT_SCHEMA_VERSION,
        type: 'error',
        error: { kind, message },
      })
    : `error [${kind}]: ${message}`
  stderr(`${output}\n`)
  return kind
}

export function validateSessionsCliOutputMode(input: {
  readonly json: boolean
  readonly jsonl: boolean
  readonly stream: boolean
}) {
  if (input.json && input.jsonl) {
    throw new CliError('usage', 'Choose either --json or --jsonl, not both.')
  }
  if (input.stream && input.json) {
    throw new CliError('usage', 'Streaming commands use --jsonl, not --json.')
  }
  if (!input.stream && input.jsonl) {
    throw new CliError('usage', 'Single-response commands use --json, not --jsonl.')
  }
}
