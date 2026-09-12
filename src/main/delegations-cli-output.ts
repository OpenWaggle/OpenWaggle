import { writeCliStdout } from './cli-stdout'

const JSON_INDENT_SPACES = 2
export const DELEGATIONS_CLI_OUTPUT_SCHEMA_VERSION = 1 as const

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
        : 'Delegation Result'
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

export function writeDelegationsCliResponse(command: string, value: unknown, json: boolean) {
  const output = json
    ? JSON.stringify(
        {
          schemaVersion: DELEGATIONS_CLI_OUTPUT_SCHEMA_VERSION,
          type: 'response',
          command,
          result: value,
        },
        null,
        JSON_INDENT_SPACES,
      )
    : humanOutcome(value)
  return writeCliStdout(`${output}\n`)
}
