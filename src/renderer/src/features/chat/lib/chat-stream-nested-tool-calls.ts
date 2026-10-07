import { matchBy } from '@diegogbrisa/ts-match'
import type { ChatNestedToolCall, ChatToolCallPart, UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import { stringifyToolInput } from './chat-stream-state-helpers'

type ToolExecutionEvent = Extract<
  AgentTransportEvent,
  { type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end' }
>

/**
 * The model-issued call a nested call belongs under: its parent, or the call that owns its parent
 * when a nested tool made the call. Nested calls of any depth sit in one list, as Pi records them.
 */
function ownsNestedCall(part: ChatToolCallPart, parentToolCallId: string) {
  return (
    part.id === parentToolCallId ||
    (part.nestedCalls?.some((call) => call.id === parentToolCallId) ?? false)
  )
}

function nextNestedCall(
  existing: ChatNestedToolCall | undefined,
  event: ToolExecutionEvent,
): ChatNestedToolCall {
  const base = {
    id: event.toolCallId,
    name: event.toolName,
    ...(existing?.arguments !== undefined ? { arguments: existing.arguments } : {}),
  }
  return matchBy(event, 'type')
    .with(
      'tool_execution_start',
      (value): ChatNestedToolCall => ({
        ...base,
        arguments: stringifyToolInput(value.args),
        state: 'executing',
      }),
    )
    .with(
      'tool_execution_update',
      (value): ChatNestedToolCall => ({
        ...base,
        arguments: stringifyToolInput(value.args),
        state: 'executing',
        partialOutput: value.partialResult,
      }),
    )
    .with(
      'tool_execution_end',
      (value): ChatNestedToolCall => ({
        ...base,
        ...(value.args !== undefined ? { arguments: stringifyToolInput(value.args) } : {}),
        state: value.isError ? 'error' : 'complete',
        output: value.result,
      }),
    )
    .exhaustive()
}

function withNestedCall(part: ChatToolCallPart, event: ToolExecutionEvent): ChatToolCallPart {
  const calls = part.nestedCalls ?? []
  const existing = calls.find((call) => call.id === event.toolCallId)
  const next = nextNestedCall(existing, event)
  return {
    ...part,
    nestedCalls: existing
      ? calls.map((call) => (call.id === event.toolCallId ? next : call))
      : [...calls, next],
  }
}

/**
 * Applies a tool execution event of a nested call to the tool call that owns it. A nested call
 * never becomes a part of its own: when no owning call is known, the event is dropped.
 */
export function applyNestedToolExecution(
  messages: readonly UIMessage[],
  event: ToolExecutionEvent,
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
    return {
      ...message,
      parts: message.parts.map((part, index) =>
        index === partIndex ? withNestedCall(owner, event) : part,
      ),
    }
  })
}
