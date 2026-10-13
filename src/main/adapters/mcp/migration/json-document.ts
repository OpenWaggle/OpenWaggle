import { createHash } from 'node:crypto'
import { isRecord } from '@shared/utils/validation'

const DEFAULT_INDENT = '  '
const INDENT_PATTERN = /^([ \t]+)\S/m

export interface JsonDocument {
  readonly value: Record<string, unknown>
  readonly indent: string
}

/** Parse a JSON object file, remembering its indentation the way Pi's writer does. */
export function parseJsonDocument(filePath: string, text: string): JsonDocument {
  const parsed: unknown = text.trim() ? JSON.parse(text) : {}
  if (!isRecord(parsed)) throw new Error(`${filePath}: expected a JSON object`)
  return { value: parsed, indent: INDENT_PATTERN.exec(text)?.[1] ?? DEFAULT_INDENT }
}

export function serializeJsonDocument(document: JsonDocument) {
  return `${JSON.stringify(document.value, null, document.indent)}\n`
}

export function contentHash(text: string | undefined) {
  return text === undefined ? null : createHash('sha256').update(text).digest('hex')
}

/** Replace one top-level key, keeping its position (or appending it). */
export function withTopLevelKey(
  value: Record<string, unknown>,
  key: string,
  next: unknown,
  replacesKey: string = key,
) {
  const result: Record<string, unknown> = {}
  let placed = false
  for (const [currentKey, currentValue] of Object.entries(value)) {
    if (currentKey === replacesKey) {
      result[key] = next
      placed = true
      continue
    }
    result[currentKey] = currentValue
  }
  if (!placed) result[key] = next
  return result
}
