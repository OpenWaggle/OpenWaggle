import { safeDecodeUnknown } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'

export const MAX_CHANGE_REQUEST_ITEMS = 100
export const CHANGE_REQUEST_MERGE_METHODS = ['merge', 'squash', 'rebase'] as const

export function asObject(value: unknown) {
  const decoded = safeDecodeUnknown(jsonObjectSchema, value)
  return decoded.success ? decoded.data : null
}

export function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function asNumericCount(value: unknown): number | null {
  const number = typeof value === 'string' && /^\d+$/u.test(value.trim()) ? Number(value) : value
  return asCount(number)
}

export function boundedObjects(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_CHANGE_REQUEST_ITEMS).flatMap((entry) => {
    const object = asObject(entry)
    return object ? [object] : []
  })
}

export function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
