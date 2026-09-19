import type { Message } from '@shared/types/agent'
import { MessageId, ToolCallId } from '@shared/types/brand'
import { SESSION_TOOL_CAPTURE_LIMIT } from '../session-resource-capture'
import { assistantToolResultMessage } from './session-resource-capture.fixtures'

export function toolMessages(messagePrefix: string, toolPrefix: string): Message[] {
  return Array.from({ length: SESSION_TOOL_CAPTURE_LIMIT + 8 }, (_, index) => ({
    ...assistantToolResultMessage(),
    id: MessageId(`${messagePrefix}-${String(index)}`),
    parts: [
      {
        type: 'tool-result' as const,
        toolResult: {
          id: ToolCallId(`${toolPrefix}-${String(index)}`),
          name: 'grep',
          args: { pattern: String(index) },
          result: '',
          isError: false,
          duration: 1,
        },
      },
    ],
  }))
}

export function failedOrchestrationMessages(): Message[] {
  return Array.from({ length: SESSION_TOOL_CAPTURE_LIMIT + 8 }, (_, index) => ({
    ...assistantToolResultMessage(),
    id: MessageId(`assistant-failed-orchestration-${String(index)}`),
    parts: [
      {
        type: 'tool-result' as const,
        toolResult: {
          id: ToolCallId(`failed-orchestration-${String(index)}`),
          name: 'mcp_run',
          args: {},
          result: null,
          isError: true,
          duration: 1,
          details: {
            kind: 'orchestration' as const,
            result: [
              {
                id: `completed-child-${String(index)}`,
                handle: `opaque-${String(index)}`,
                status: 'completed' as const,
                provenance: {
                  handle: `opaque-${String(index)}`,
                  serverInstanceId: 'docs-1',
                  serverLabel: 'Documentation',
                  toolName: 'lookup_docs',
                },
                result: { operation: 'call', text: `Found docs ${String(index)}.` },
              },
            ],
          },
        },
      },
    ],
  }))
}
