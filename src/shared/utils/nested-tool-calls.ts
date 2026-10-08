import type { JsonObject, JsonValue } from '../types/json'
import type { AgentTransportEvent } from '../types/stream'
import type { NestedToolCallRecord, NestedToolCalls } from '../types/tools'

/**
 * The limits Pi puts on the nested-call record of a tool result (`NESTED_CALL_LIMITS` in Pi's
 * `core/nested-tool-calls.js`). The live record OpenWaggle builds from nested call events uses the
 * same limits, so a list looks the same while the Run streams, after a reconnect, and after reload.
 */
export const NESTED_TOOL_CALL_LIMITS = {
  maxCalls: 256,
  maxArgumentBytesPerCall: 8 * 1024,
  maxArgumentBytesTotal: 32 * 1024,
  maxErrorChars: 500,
} as const

export type NestedToolExecutionEvent = Extract<
  AgentTransportEvent,
  { type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end' }
>

const encoder = new TextEncoder()
const EMPTY_RECORD: NestedToolCalls = { calls: [], complete: true }

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resultText(result: JsonValue) {
  if (typeof result === 'string') return result
  if (isJsonObject(result) && Array.isArray(result.content)) {
    return result.content
      .map((block) => (isJsonObject(block) && typeof block.text === 'string' ? block.text : ''))
      .join('\n')
  }
  return JSON.stringify(result)
}

function recordedArgumentBytes(calls: readonly NestedToolCallRecord[]) {
  return calls.reduce(
    (total, call) =>
      call.args === undefined ? total : total + encoder.encode(JSON.stringify(call.args)).length,
    0,
  )
}

function startedRecord(
  calls: readonly NestedToolCallRecord[],
  event: NestedToolExecutionEvent,
): NestedToolCallRecord {
  const args = isJsonObject(event.args) ? event.args : {}
  const bytes = encoder.encode(JSON.stringify(args)).length
  const fits =
    bytes <= NESTED_TOOL_CALL_LIMITS.maxArgumentBytesPerCall &&
    recordedArgumentBytes(calls) + bytes <= NESTED_TOOL_CALL_LIMITS.maxArgumentBytesTotal
  return {
    id: event.toolCallId,
    name: event.toolName,
    ...(fits ? { args } : { argsBytes: bytes }),
    status: 'unfinished',
  }
}

function finishedRecord(
  record: NestedToolCallRecord,
  event: NestedToolExecutionEvent,
): NestedToolCallRecord {
  if (event.type !== 'tool_execution_end') return record
  if (!event.isError) return { ...record, status: 'ok' }
  const error = resultText(event.result).slice(0, NESTED_TOOL_CALL_LIMITS.maxErrorChars)
  return { ...record, status: 'error', ...(error ? { error } : {}) }
}

function withCompleteness(
  calls: readonly NestedToolCallRecord[],
  droppedCalls: number,
): NestedToolCalls {
  const complete =
    droppedCalls === 0 &&
    calls.every((call) => call.status !== 'unfinished' && call.argsBytes === undefined)
  return { calls, complete, ...(droppedCalls > 0 ? { droppedCalls } : {}) }
}

/**
 * Applies one nested call event to a bounded record, the way Pi records nested calls: arguments
 * are kept from the call's start and left out past the size limits, results are not kept, error
 * text is truncated, and calls past the maximum are dropped and counted.
 */
export function recordNestedToolExecution(
  record: NestedToolCalls | undefined,
  event: NestedToolExecutionEvent,
): NestedToolCalls {
  const { calls, droppedCalls = 0 } = record ?? EMPTY_RECORD
  const index = calls.findIndex((call) => call.id === event.toolCallId)
  const existing = calls[index]
  if (existing) {
    const next = finishedRecord(existing, event)
    if (next === existing) return record ?? EMPTY_RECORD
    return withCompleteness(
      calls.map((call, callIndex) => (callIndex === index ? next : call)),
      droppedCalls,
    )
  }
  if (calls.length >= NESTED_TOOL_CALL_LIMITS.maxCalls) {
    // A dropped call is counted when it starts; its later events change nothing.
    return withCompleteness(
      calls,
      event.type === 'tool_execution_start' ? droppedCalls + 1 : droppedCalls,
    )
  }
  return withCompleteness(
    [...calls, finishedRecord(startedRecord(calls, event), event)],
    droppedCalls,
  )
}

function isFinished(call: NestedToolCallRecord) {
  return call.status !== 'unfinished'
}

/** Incomplete with nothing visible to say why: Pi's record dropped calls it does not count. */
function hidesDroppedCalls(record: NestedToolCalls) {
  return (
    !record.complete &&
    (record.droppedCalls ?? 0) === 0 &&
    record.calls.every((call) => isFinished(call) && call.argsBytes === undefined)
  )
}

/**
 * Two copies of one tool call's record, such as a reconnect's buffer and the shown transcript,
 * merged call by call: each call once, in a finished state if either copy saw it finish (a status
 * only moves from unfinished to ok or error), the larger count of dropped calls, and incomplete
 * when either copy knows of calls neither holds.
 */
export function mergeNestedToolCalls(
  first: NestedToolCalls | undefined,
  second: NestedToolCalls | undefined,
): NestedToolCalls | undefined {
  if (!first || !second) return first ?? second
  const byId = new Map<string, NestedToolCallRecord>()
  for (const call of [...first.calls, ...second.calls]) {
    const known = byId.get(call.id)
    if (!known || (!isFinished(known) && isFinished(call))) byId.set(call.id, call)
  }
  const calls = [...byId.values()].slice(0, NESTED_TOOL_CALL_LIMITS.maxCalls)
  const droppedCalls =
    Math.max(first.droppedCalls ?? 0, second.droppedCalls ?? 0) + (byId.size - calls.length)
  const merged = withCompleteness(calls, droppedCalls)
  return hidesDroppedCalls(first) || hidesDroppedCalls(second)
    ? { ...merged, complete: false }
    : merged
}

/**
 * Whether the model-issued call `ownerId` owns a nested call made by `parentToolCallId`: the owner
 * itself, any call under it (Pi names nested calls `<callerId>/<n>`, so this holds for calls the
 * record dropped), or a call in its record.
 */
export function ownsNestedToolCall(
  ownerId: string,
  record: NestedToolCalls | undefined,
  parentToolCallId: string,
) {
  return (
    parentToolCallId === ownerId ||
    parentToolCallId.startsWith(`${ownerId}/`) ||
    (record?.calls.some((call) => call.id === parentToolCallId) ?? false)
  )
}
