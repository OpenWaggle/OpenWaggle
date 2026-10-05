/** Immutable helpers for the JSON objects of error reports. */
import { isRecord } from './http'

export type JsonRecord = Readonly<Record<string, unknown>>

export function withoutKeys(record: JsonRecord, keys: ReadonlySet<string>): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)))
}

export function onlyKeys(record: JsonRecord, keys: ReadonlySet<string>): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([key]) => keys.has(key)))
}

/** `record` with the object at `key` replaced by `update(object)`, when it is an object. */
export function updateRecord(
  record: JsonRecord,
  key: string,
  update: (value: JsonRecord) => JsonRecord,
) {
  const value = record[key]
  return isRecord(value) ? { ...record, [key]: update(value) } : record
}

/** `record` with every object in the list at `key` replaced by `update(object)`. */
export function updateList(
  record: JsonRecord,
  key: string,
  update: (value: JsonRecord) => JsonRecord,
) {
  const value: unknown = record[key]
  if (!Array.isArray(value)) return record
  const items: readonly unknown[] = value
  return { ...record, [key]: items.map((item) => (isRecord(item) ? update(item) : item)) }
}
