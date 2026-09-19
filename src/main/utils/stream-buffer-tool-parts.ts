import type { MessagePart } from '@shared/types/agent'
import type { AgentTransportEvent } from '@shared/types/stream'
import { appendToolResultPart, upsertToolCallPart } from './stream-buffer-message-parts'

function existingToolCallArgs(parts: readonly MessagePart[], toolCallId: string) {
  const part = parts.find(
    (candidate) => candidate.type === 'tool-call' && String(candidate.toolCall.id) === toolCallId,
  )
  return part?.type === 'tool-call' ? part.toolCall.args : undefined
}

export function applyToolExecutionEndToParts(
  parts: readonly MessagePart[],
  value: Extract<AgentTransportEvent, { type: 'tool_execution_end' }>,
  preserveArgs = false,
) {
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
