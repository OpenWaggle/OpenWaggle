import { match, P } from '@diegogbrisa/ts-match'
import { isObjectValue, uncheckedFields } from './object-shape'

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
  if (normalized === undefined) return false
  if (!isObjectValue(normalized) || !('details' in normalized)) return true
  const { content } = uncheckedFields<{ readonly content: readonly unknown[] }>(normalized)
  return !(Array.isArray(content) && content.length === 0)
}
