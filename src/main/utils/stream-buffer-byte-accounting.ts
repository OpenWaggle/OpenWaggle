import type { MessagePart } from '@shared/types/agent'

const JSON_STRING_QUOTES_BYTES = 2
const JSON_ARRAY_BRACKETS_BYTES = 2
const JSON_ARRAY_SEPARATOR_BYTES = 1

export function retainedPartsBytes(parts: readonly MessagePart[]) {
  return parts.length === 0 ? 0 : Buffer.byteLength(JSON.stringify(parts), 'utf8')
}

function jsonStringContentBytes(value: string) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') - JSON_STRING_QUOTES_BYTES
}

function appendedJsonStringBytes(existing: string, delta: string) {
  const boundary = existing.slice(-1)
  return jsonStringContentBytes(boundary + delta) - jsonStringContentBytes(boundary)
}

function appendedPartBytes(part: MessagePart, hasExistingParts: boolean) {
  const serializedPartBytes = Buffer.byteLength(JSON.stringify(part), 'utf8')
  return (
    serializedPartBytes +
    (hasExistingParts ? JSON_ARRAY_SEPARATOR_BYTES : JSON_ARRAY_BRACKETS_BYTES)
  )
}

export function retainedBytesAfterTextAppend(input: {
  readonly parts: readonly MessagePart[]
  readonly retainedBytes: number
  readonly type: 'text' | 'reasoning'
  readonly delta: string
}) {
  const lastPart = input.parts[input.parts.length - 1]
  if (lastPart?.type === input.type) {
    return input.retainedBytes + appendedJsonStringBytes(lastPart.text, input.delta)
  }
  return (
    input.retainedBytes +
    appendedPartBytes({ type: input.type, text: input.delta }, input.parts.length > 0)
  )
}
