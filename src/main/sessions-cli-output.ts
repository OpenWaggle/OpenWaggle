import { sessionHostErrorKindForThrownCode } from '@shared/domain/session-host-refusals'
import { CliError, type CliErrorKind } from './cli-error'
import { SESSIONS_CLI_OUTPUT_SCHEMA_VERSION } from './cli-output-schema'
import { writeCliStdout } from './cli-stdout'
import {
  LocalSessionClientProtocolError,
  LocalSessionClientTimeoutError,
  LocalSessionHostUnavailableError,
  LocalSessionHostUpgradePendingError,
} from './session-host/local-session-client-protocol-error'

const JSON_INDENT_SPACES = 2

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
  if (!isRecord(value) || !isRecord(value['response']) || !isRecord(value['response']['outcome'])) {
    return JSON.stringify(value, null, JSON_INDENT_SPACES)
  }
  const outcome = value['response']['outcome']
  const title =
    typeof outcome['effect'] === 'string'
      ? humanLabel(outcome['effect'])
      : typeof outcome['operation'] === 'string'
        ? humanLabel(outcome['operation'])
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

/** The `openwaggle` command groups that print the `--json` response envelope. */
type CliEnvelopeGroup = 'hive' | 'schedules' | 'host' | 'access' | 'agents' | 'mcp' | 'recovery'

/**
 * A `--json` envelope's `command`: the command path after `openwaggle`, space-separated, such as
 * `hive list`, `host stop` or `access profiles list` (ADR 0063). The type rejects a bare
 * subcommand, which is what `hive` and `schedules` printed before 1.0. `status` and `update` are
 * whole commands; `update` prints an envelope only for `update --check --json`.
 */
export type CliEnvelopeCommand = 'status' | 'update' | `${CliEnvelopeGroup} ${string}`

export function writeSessionsCliResponse(
  command: CliEnvelopeCommand,
  value: unknown,
  json: boolean,
) {
  return writeCliStdout(sessionsCliResponseText(command, value, json))
}

/** The text `writeSessionsCliResponse` writes, for commands with their own stdout writer. */
export function sessionsCliResponseText(
  command: CliEnvelopeCommand,
  value: unknown,
  json: boolean,
) {
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
  // The Session Host names the kind of a failure it reports (ADR 0063). A frame without one,
  // such as a handshake refusal from a Session Host older than revision 32, takes its code's
  // kind from the same table; an unlisted code is an unexpected failure.
  if (error instanceof LocalSessionClientProtocolError) {
    return error.errorKind ?? sessionHostErrorKindForThrownCode(error.code)
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
  const body = cliErrorBody(error)
  const output = machine
    ? JSON.stringify({
        schemaVersion: SESSIONS_CLI_OUTPUT_SCHEMA_VERSION,
        type: 'error',
        error: body,
      })
    : `error [${body.kind}]: ${body.message}`
  stderr(`${output}\n`)
  return body.kind
}

/**
 * The `error` of a CLI error envelope: its kind, its message, and the Session Host's refusal
 * `code` when a Session Host refusal caused the failure (ADR 0063).
 */
export function cliErrorBody(error: unknown) {
  const kind = classifySessionsCliError(error)
  const message = error instanceof Error ? error.message : String(error)
  const code =
    error instanceof CliError || error instanceof LocalSessionClientProtocolError
      ? error.code
      : undefined
  return { kind, message, ...(code ? { code } : {}) }
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
