import type { Message } from '@shared/types/agent'
import type { WaggleStreamMetadata } from '@shared/types/waggle'
import { makeMessage } from '../../agent/shared'

export interface UnresolvedToolCall {
  readonly id: string
  readonly name: string
  readonly state?: 'input-complete'
}

const UNRESOLVED_TOOL_NAME_PREVIEW_COUNT = 3

export function tagAssistantMessages(messages: readonly Message[], meta: WaggleStreamMetadata) {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) =>
      makeMessage('assistant', [...message.parts], message.model, {
        ...message.metadata,
        waggle: {
          agentIndex: meta.agentIndex,
          agentLabel: meta.agentLabel,
          agentColor: meta.agentColor,
          agentModel: meta.agentModel,
          turnNumber: meta.turnNumber,
          sessionId: meta.sessionId,
        },
      }),
    )
}

export function getUnresolvedToolCalls(message: Message) {
  const unresolvedById = new Map<string, Omit<UnresolvedToolCall, 'id'>>()

  for (const part of message.parts) {
    if (part.type !== 'tool-call') continue
    unresolvedById.set(String(part.toolCall.id), {
      name: part.toolCall.name,
      state: part.toolCall.state,
    })
  }

  for (const part of message.parts) {
    if (part.type === 'tool-result') unresolvedById.delete(String(part.toolResult.id))
  }

  return [...unresolvedById.entries()].map(([id, data]) => ({ id, ...data }))
}

export function summarizeUnresolvedTools(unresolvedToolCalls: readonly UnresolvedToolCall[]) {
  const unresolvedToolNames = unresolvedToolCalls
    .slice(0, UNRESOLVED_TOOL_NAME_PREVIEW_COUNT)
    .map((toolCall) => toolCall.name)
    .join(', ')
  const moreToolsCount = unresolvedToolCalls.length - UNRESOLVED_TOOL_NAME_PREVIEW_COUNT
  return moreToolsCount > 0
    ? `${unresolvedToolNames} (+${String(moreToolsCount)} more)`
    : unresolvedToolNames
}

export function extractFilePath(input: unknown) {
  if (input == null || typeof input !== 'object') return ''
  const path = 'path' in input ? input.path : 'filePath' in input ? input.filePath : ''
  return typeof path === 'string' ? path : ''
}
