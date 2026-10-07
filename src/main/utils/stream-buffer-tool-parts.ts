import type { MessagePart } from '@shared/types/agent'
import type { AgentTransportEvent } from '@shared/types/stream'
import { appendToolResultPart, upsertToolCallPart } from './stream-buffer-message-parts'
import { applyNestedToolExecutionToParts } from './stream-buffer-nested-calls'

function existingToolCallArgs(parts: readonly MessagePart[], toolCallId: string) {
  const part = parts.find(
    (candidate) => candidate.type === 'tool-call' && String(candidate.toolCall.id) === toolCallId,
  )
  return part?.type === 'tool-call' ? part.toolCall.args : undefined
}

/**
 * A model-issued call becomes a tool-call part. A nested call (Pi `ctx.executeTool()`) has no
 * transcript entry and never becomes a part; it is recorded on the call that owns it.
 */
export function applyToolExecutionStartToParts(
  parts: readonly MessagePart[],
  value: Extract<AgentTransportEvent, { type: 'tool_execution_start' | 'tool_execution_update' }>,
) {
  if (value.parentToolCallId)
    return applyNestedToolExecutionToParts(parts, value, value.parentToolCallId)
  return upsertToolCallPart({
    parts,
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    args: value.args,
  })
}

export function applyToolExecutionEndToParts(
  parts: readonly MessagePart[],
  value: Extract<AgentTransportEvent, { type: 'tool_execution_end' }>,
  preserveArgs = false,
) {
  if (value.parentToolCallId)
    return applyNestedToolExecutionToParts(parts, value, value.parentToolCallId)
  const args = preserveArgs ? existingToolCallArgs(parts, value.toolCallId) : value.args
  return appendToolResultPart({
    parts: upsertToolCallPart({
      parts,
      toolCallId: value.toolCallId,
      toolName: value.toolName,
      args,
    }),
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    args,
    result: value.result,
    isError: value.isError,
  })
}
