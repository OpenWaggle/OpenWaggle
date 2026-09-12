import type { TerminalInputIntent } from '@shared/types/terminal'
import { chunkTerminalInput } from './terminal-input'
import type { TerminalProjectActionEnqueueResult } from './terminal-input-dispatch-types'

export interface QueuedTerminalInput {
  readonly data: string
  readonly byteLength: number
  readonly intent?: TerminalInputIntent
  readonly settle?: (result: TerminalProjectActionEnqueueResult) => void
  /** An unresolved async input operation that reserves this exact queue position. */
  readonly pending?: true
}

export interface TerminalInputQueue {
  readonly items: QueuedTerminalInput[]
  head: number
  byteLength: number
}

export type TerminalInputQueueAppendResult =
  | { readonly status: 'accepted'; readonly byteLength: number }
  | { readonly status: 'capacity' }

export type TerminalInputPlaceholderResolution =
  | TerminalInputQueueAppendResult
  | { readonly status: 'inactive' }

const QUEUE_COMPACTION_HEAD_MINIMUM = 64
const ASCII_MAX_CODE_POINT = 0x7f
const TWO_BYTE_UTF8_MAX_CODE_POINT = 0x7ff
const THREE_BYTE_UTF8_MAX_CODE_POINT = 0xffff
const TWO_UTF8_BYTES = 2
const THREE_UTF8_BYTES = 3
const FOUR_UTF8_BYTES = 4
const QUEUE_COMPACTION_DIVISOR = 2

function utf8Width(character: string) {
  const codePoint = character.codePointAt(0)
  if (codePoint === undefined) return 0
  if (codePoint <= ASCII_MAX_CODE_POINT) return 1
  if (codePoint <= TWO_BYTE_UTF8_MAX_CODE_POINT) return TWO_UTF8_BYTES
  if (codePoint <= THREE_BYTE_UTF8_MAX_CODE_POINT) return THREE_UTF8_BYTES
  return FOUR_UTF8_BYTES
}

/** Returns null as soon as the UTF-8 input exceeds the supplied byte budget. */
function boundedUtf8ByteLength(data: string, byteBudget: number): number | null {
  let byteLength = 0
  for (const character of data) {
    byteLength += utf8Width(character)
    if (byteLength > byteBudget) return null
  }
  return byteLength
}

function exactUtf8ByteLength(data: string) {
  let byteLength = 0
  for (const character of data) byteLength += utf8Width(character)
  return byteLength
}

export function createTerminalInputQueue(): TerminalInputQueue {
  return { items: [], head: 0, byteLength: 0 }
}

export function terminalInputQueueLength(queue: TerminalInputQueue) {
  return queue.items.length - queue.head
}

export function terminalInputQueueHead(queue: TerminalInputQueue) {
  return queue.items[queue.head]
}

export function appendTerminalInput(
  queue: TerminalInputQueue,
  data: string,
  byteBudget: number,
): TerminalInputQueueAppendResult {
  const byteLength = boundedUtf8ByteLength(data, byteBudget)
  if (byteLength === null) return { status: 'capacity' }
  for (const chunk of chunkTerminalInput(data)) {
    queue.items.push({ data: chunk, byteLength: exactUtf8ByteLength(chunk) })
  }
  queue.byteLength += byteLength
  return { status: 'accepted', byteLength }
}

/** Append one semantic command without splitting its main-process arbitration boundary. */
export function appendTerminalProjectAction(
  queue: TerminalInputQueue,
  data: string,
  byteBudget: number,
  executionId: string,
  settle: (result: TerminalProjectActionEnqueueResult) => void,
): TerminalInputQueueAppendResult {
  const byteLength = boundedUtf8ByteLength(data, byteBudget)
  if (byteLength === null) return { status: 'capacity' }
  queue.items.push({
    data,
    byteLength,
    intent: { kind: 'project-action', executionId },
    settle,
  })
  queue.byteLength += byteLength
  return { status: 'accepted', byteLength }
}

export function hasQueuedTerminalProjectAction(queue: TerminalInputQueue) {
  return queue.items.slice(queue.head).some((item) => item.intent?.kind === 'project-action')
}

/** Reserve an async read's position so later synchronous keys cannot overtake it. */
export function appendTerminalInputPlaceholder(queue: TerminalInputQueue): QueuedTerminalInput {
  const placeholder = { data: '', byteLength: 0, pending: true } as const
  queue.items.push(placeholder)
  return placeholder
}

function placeholderIndex(queue: TerminalInputQueue, placeholder: QueuedTerminalInput) {
  return queue.items.indexOf(placeholder, queue.head)
}

export function removeTerminalInputPlaceholder(
  queue: TerminalInputQueue,
  placeholder: QueuedTerminalInput,
) {
  const index = placeholderIndex(queue, placeholder)
  if (index < 0) return false
  queue.items.splice(index, 1)
  return true
}

/** Replace one ordered async placeholder with the resolved byte-bounded chunks. */
export function resolveTerminalInputPlaceholder(
  queue: TerminalInputQueue,
  placeholder: QueuedTerminalInput,
  data: string,
  byteBudget: number,
): TerminalInputPlaceholderResolution {
  const index = placeholderIndex(queue, placeholder)
  if (index < 0) return { status: 'inactive' }
  const byteLength = boundedUtf8ByteLength(data, byteBudget)
  if (byteLength === null) {
    queue.items.splice(index, 1)
    return { status: 'capacity' }
  }
  const chunks = chunkTerminalInput(data).map((chunk) => ({
    data: chunk,
    byteLength: exactUtf8ByteLength(chunk),
  }))
  queue.items.splice(index, 1, ...chunks)
  queue.byteLength += byteLength
  return { status: 'accepted', byteLength }
}

export function removeTerminalInputHead(queue: TerminalInputQueue, expected: QueuedTerminalInput) {
  if (terminalInputQueueHead(queue) !== expected) return false
  queue.head += 1
  queue.byteLength = Math.max(0, queue.byteLength - expected.byteLength)
  if (
    queue.head >= QUEUE_COMPACTION_HEAD_MINIMUM &&
    queue.head * QUEUE_COMPACTION_DIVISOR >= queue.items.length
  ) {
    queue.items.splice(0, queue.head)
    queue.head = 0
  }
  return true
}

export function clearTerminalInputQueue(queue: TerminalInputQueue) {
  for (const item of queue.items.slice(queue.head)) {
    item.settle?.({
      status: 'rejected',
      reason: 'inactive',
      error: 'Terminal input is no longer available.',
    })
  }
  queue.items.length = 0
  queue.head = 0
  queue.byteLength = 0
}
