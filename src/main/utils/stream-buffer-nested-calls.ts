import type { MessagePart } from '@shared/types/agent'
import type { JsonObject, JsonValue } from '@shared/types/json'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { NestedToolCallRecord, NestedToolCalls } from '@shared/types/tools'

/**
 * Nested calls kept per model-issued tool call in the live buffer, so a renderer that reconnects
 * mid-Run still shows the calls a codemode script already made. Pi's own record on the persisted
 * result replaces this one when the Run settles.
 */
export const MAX_LIVE_NESTED_TOOL_CALLS = 64
/** Arguments above this size are left out, as Pi leaves out large arguments in its record. */
const MAX_LIVE_NESTED_ARGS_BYTES = 4096
const MAX_LIVE_NESTED_ERROR_CHARS = 500

export type NestedToolExecutionEvent = Extract<
  AgentTransportEvent,
  { type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end' }
>

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedArgs(
  args: JsonValue | undefined,
): Pick<NestedToolCallRecord, 'args' | 'argsBytes'> {
  if (!isJsonObject(args)) return {}
  const bytes = Buffer.byteLength(JSON.stringify(args))
  return bytes > MAX_LIVE_NESTED_ARGS_BYTES ? { argsBytes: bytes } : { args }
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

function nextRecord(
  existing: NestedToolCallRecord | undefined,
  event: NestedToolExecutionEvent,
): NestedToolCallRecord {
  const args =
    event.args !== undefined
      ? boundedArgs(event.args)
      : {
          ...(existing?.args ? { args: existing.args } : {}),
          ...(existing?.argsBytes ? { argsBytes: existing.argsBytes } : {}),
        }
  if (event.type !== 'tool_execution_end') {
    return { id: event.toolCallId, name: event.toolName, ...args, status: 'unfinished' }
  }
  return {
    id: event.toolCallId,
    name: event.toolName,
    ...args,
    status: event.isError ? 'error' : 'ok',
    ...(event.isError
      ? { error: resultText(event.result).slice(0, MAX_LIVE_NESTED_ERROR_CHARS) }
      : {}),
  }
}

function isComplete(calls: readonly NestedToolCallRecord[], dropped: boolean) {
  return (
    !dropped && calls.every((call) => call.status !== 'unfinished' && call.argsBytes === undefined)
  )
}

function withNestedCall(
  record: NestedToolCalls | undefined,
  event: NestedToolExecutionEvent,
): NestedToolCalls {
  const calls = record?.calls ?? []
  const dropped = record ? !record.complete && calls.length >= MAX_LIVE_NESTED_TOOL_CALLS : false
  const existing = calls.find((call) => call.id === event.toolCallId)
  if (!existing && calls.length >= MAX_LIVE_NESTED_TOOL_CALLS) {
    return { calls, complete: false }
  }
  const next = nextRecord(existing, event)
  const nextCalls = existing
    ? calls.map((call) => (call.id === event.toolCallId ? next : call))
    : [...calls, next]
  return { calls: nextCalls, complete: isComplete(nextCalls, dropped) }
}

function ownsNestedCall(part: MessagePart, parentToolCallId: string) {
  return (
    part.type === 'tool-call' &&
    (String(part.toolCall.id) === parentToolCallId ||
      (part.toolCall.nestedCalls?.calls.some((call) => call.id === parentToolCallId) ?? false))
  )
}

/**
 * Records a nested call (Pi `ctx.executeTool()`) on the model-issued tool call that owns it: its
 * parent, or the call whose list holds its parent. A nested call never becomes a part of its own;
 * with no known owner the event is dropped.
 */
export function applyNestedToolExecutionToParts(
  parts: readonly MessagePart[],
  event: NestedToolExecutionEvent,
  parentToolCallId: string,
): readonly MessagePart[] {
  const index = parts.findIndex((part) => ownsNestedCall(part, parentToolCallId))
  const owner = parts[index]
  if (owner?.type !== 'tool-call') return parts
  const updated: MessagePart = {
    type: 'tool-call',
    toolCall: { ...owner.toolCall, nestedCalls: withNestedCall(owner.toolCall.nestedCalls, event) },
  }
  return [...parts.slice(0, index), updated, ...parts.slice(index + 1)]
}
