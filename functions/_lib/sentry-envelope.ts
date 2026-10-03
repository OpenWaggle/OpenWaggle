/**
 * Sentry envelope parsing and writing. An envelope is a JSON header line followed by items,
 * each a JSON header line and a payload. A payload is exactly `length` bytes when its header
 * gives one, otherwise it runs to the next newline.
 * https://develop.sentry.dev/sdk/data-model/envelopes/
 */
import { decodeUtf8, encodeUtf8, isRecord, parseJsonText } from './http'

const NEWLINE_BYTE = 10

export interface SentryEnvelopeItem {
  readonly header: Readonly<Record<string, unknown>>
  readonly payload: Uint8Array
}

export interface SentryEnvelope {
  readonly header: Readonly<Record<string, unknown>>
  readonly items: readonly SentryEnvelopeItem[]
}

function lineEnd(bytes: Uint8Array, start: number) {
  const index = bytes.indexOf(NEWLINE_BYTE, start)
  return index === -1 ? bytes.length : index
}

function jsonObjectLine(bytes: Uint8Array, start: number, end: number) {
  const parsed = parseJsonText(decodeUtf8(bytes.subarray(start, end)))
  return parsed.ok && isRecord(parsed.value) ? parsed.value : undefined
}

function payloadEnd(bytes: Uint8Array, start: number, length: unknown) {
  if (length === undefined) return lineEnd(bytes, start)
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return undefined
  return start + length <= bytes.length ? start + length : undefined
}

function readItem(bytes: Uint8Array, start: number) {
  const headerEnd = lineEnd(bytes, start)
  const header = jsonObjectLine(bytes, start, headerEnd)
  if (header === undefined) return undefined
  const payloadStart = Math.min(headerEnd + 1, bytes.length)
  const end = payloadEnd(bytes, payloadStart, header.length)
  if (end === undefined) return undefined
  const item: SentryEnvelopeItem = { header, payload: bytes.subarray(payloadStart, end) }
  return { item, next: bytes[end] === NEWLINE_BYTE ? end + 1 : end }
}

/** Parses an envelope, or returns `undefined` when it is malformed or has too many items. */
export function parseSentryEnvelope(
  bytes: Uint8Array,
  maxItems: number,
): SentryEnvelope | undefined {
  const headerEnd = lineEnd(bytes, 0)
  const header = jsonObjectLine(bytes, 0, headerEnd)
  if (header === undefined) return undefined
  const items: SentryEnvelopeItem[] = []
  let position = headerEnd + 1
  while (position < bytes.length) {
    if (bytes[position] === NEWLINE_BYTE) {
      position += 1
      continue
    }
    const read = readItem(bytes, position)
    if (read === undefined) return undefined
    items.push(read.item)
    if (items.length > maxItems) return undefined
    position = read.next
  }
  return { header, items }
}

export interface OutgoingEnvelopeItem {
  readonly type: string
  readonly payload: unknown
}

/** Writes an envelope whose item headers give each payload's exact byte length. */
export function serializeSentryEnvelope(
  header: Readonly<Record<string, unknown>>,
  items: readonly OutgoingEnvelopeItem[],
): string {
  const lines = [JSON.stringify(header)]
  for (const item of items) {
    const payload = JSON.stringify(item.payload)
    lines.push(JSON.stringify({ type: item.type, length: encodeUtf8(payload).byteLength }), payload)
  }
  return `${lines.join('\n')}\n`
}
