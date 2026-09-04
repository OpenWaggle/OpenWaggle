import type { MessagePart } from '@shared/types/agent'
import type { AgentTransportEvent } from '@shared/types/stream'
import { appendToolResultPart, upsertToolCallPart } from './stream-buffer-message-parts'

export function applyToolExecutionEndToParts(
  parts: readonly MessagePart[],
  value: Extract<AgentTransportEvent, { type: 'tool_execution_end' }>,
) {
  return appendToolResultPart({
    parts: upsertToolCallPart({
      parts,
      toolCallId: value.toolCallId,
      toolName: value.toolName,
      args: value.args,
    }),
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    args: value.args,
    result: value.result,
    isError: value.isError,
  })
}
