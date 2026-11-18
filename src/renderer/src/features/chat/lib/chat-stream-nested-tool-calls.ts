import type { ChatToolCallPart, UIMessage } from '@shared/types/chat-ui'
import {
  type NestedToolExecutionEvent,
  ownsNestedToolCall,
  recordNestedToolExecution,
} from '@shared/utils/nested-tool-calls'

function ownsNestedCall(part: ChatToolCallPart, parentToolCallId: string) {
  return ownsNestedToolCall(part.id, part.nestedCalls, parentToolCallId)
}

/**
 * Applies a tool execution event of a nested call to the tool call that owns it, in a record with
 * Pi's limits: no results, bounded arguments and errors, and at most Pi's number of calls, so a
 * script that makes hundreds of calls cannot fill renderer state. A nested call never becomes a
 * part of its own: when no owning call is known, the event is dropped.
 */
export function applyNestedToolExecution(
  messages: readonly UIMessage[],
  event: NestedToolExecutionEvent,
  parentToolCallId: string,
) {
  let applied = false
  return messages.map((message) => {
    if (applied || message.role !== 'assistant') return message
    const partIndex = message.parts.findIndex(
      (part) => part.type === 'tool-call' && ownsNestedCall(part, parentToolCallId),
    )
    const owner = message.parts[partIndex]
    if (owner?.type !== 'tool-call') return message
    applied = true
    const updated: ChatToolCallPart = {
      ...owner,
      nestedCalls: recordNestedToolExecution(owner.nestedCalls, event),
    }
    return {
      ...message,
      parts: message.parts.map((part, index) => (index === partIndex ? updated : part)),
    }
  })
}
