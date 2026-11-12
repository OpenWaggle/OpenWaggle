import { match, P } from '@diegogbrisa/ts-match'
import { isRecord } from './validation'

export function parseSerializedToolPayload(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function unwrapStructuredToolPayload(value: unknown): unknown {
  return match(value)
    .with({ kind: 'json', data: P.select() }, (data) => data)
    .with({ kind: 'text', text: P.select() }, (text) => text)
    .otherwise(() => value)
}

export function normalizeToolResultPayload(value: unknown): unknown {
  return unwrapStructuredToolPayload(parseSerializedToolPayload(value))
}

export function hasConcreteToolOutput(value: unknown): boolean {
  const normalized = normalizeToolResultPayload(value)
  return !(
    normalized === undefined ||
    (isRecord(normalized) &&
      Array.isArray(normalized.content) &&
      normalized.content.length === 0 &&
      'details' in normalized)
  )
}
