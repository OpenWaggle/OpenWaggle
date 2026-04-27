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
  if (!isRecord(value)) {
    return value
  }

  if (value.kind === 'json' && 'data' in value) {
    return value.data
  }

  if (value.kind === 'text' && 'text' in value) {
    return value.text
  }

  return value
}

export function normalizeToolResultPayload(value: unknown): unknown {
  return unwrapStructuredToolPayload(parseSerializedToolPayload(value))
}

export function hasConcreteToolOutput(value: unknown): boolean {
  return value !== undefined
}
