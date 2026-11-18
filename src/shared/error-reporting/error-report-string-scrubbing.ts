/**
 * Applies a text scrubber to every string of a JSON-like report, object keys included, in place.
 * Part of the error-report scrubbing (./error-report-scrubbing.ts).
 */
import { isRecord } from '../utils/validation'

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function scrubArrayStrings(
  values: unknown[],
  scrub: (text: string) => string,
  seen: WeakSet<object>,
) {
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index]
    if (typeof item === 'string') values[index] = scrub(item)
    else scrubStringsInPlace(item, scrub, seen)
  }
}

function scrubRecordStrings(
  record: Record<string, unknown>,
  scrub: (text: string) => string,
  seen: WeakSet<object>,
  verbatimKeys: ReadonlySet<string>,
) {
  for (const key of Object.keys(record)) {
    if (verbatimKeys.has(key)) continue
    const item = record[key]
    if (typeof item === 'string') record[key] = scrub(item)
    else scrubStringsInPlace(item, scrub, seen)
    const scrubbedKey = scrub(key)
    if (scrubbedKey === key) continue
    record[scrubbedKey] = record[key]
    delete record[key]
  }
}

/** Applies `scrub` to every string, object keys included, in a JSON-like value. */
export function scrubStringsInPlace(
  value: unknown,
  scrub: (text: string) => string,
  seen = new WeakSet<object>(),
  verbatimKeys: ReadonlySet<string> = new Set(),
) {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  if (isUnknownArray(value)) {
    scrubArrayStrings(value, scrub, seen)
    return
  }
  if (isRecord(value)) scrubRecordStrings(value, scrub, seen, verbatimKeys)
}
