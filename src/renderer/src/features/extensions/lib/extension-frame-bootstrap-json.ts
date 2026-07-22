import type { JsonValue } from '@shared/types/json'
import { isRecord } from '@shared/utils/validation'

export function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }

  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue)
  }

  return false
}

export function isOptionalJsonValue(value: unknown): value is JsonValue | undefined {
  return value === undefined || isJsonValue(value)
}
