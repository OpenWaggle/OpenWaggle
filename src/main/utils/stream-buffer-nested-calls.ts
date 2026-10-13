import type { MessagePart } from '@shared/types/agent'
import {
  type NestedToolExecutionEvent,
  ownsNestedToolCall,
  recordNestedToolExecution,
} from '@shared/utils/nested-tool-calls'

function ownsNestedCall(part: MessagePart, parentToolCallId: string) {
  return (
    part.type === 'tool-call' &&
    ownsNestedToolCall(String(part.toolCall.id), part.toolCall.nestedCalls, parentToolCallId)
  )
}

/**
 * Records a nested call (Pi `ctx.executeTool()`) on the model-issued tool call that owns it, so a
 * renderer that reconnects mid-Run still shows the calls a codemode script already made. The record
 * has Pi's limits; Pi's own record on the persisted result replaces it when the Run settles. A
 * nested call never becomes a part of its own; with no known owner the event is dropped.
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
    toolCall: {
      ...owner.toolCall,
      nestedCalls: recordNestedToolExecution(owner.toolCall.nestedCalls, event),
    },
  }
  return [...parts.slice(0, index), updated, ...parts.slice(index + 1)]
}
