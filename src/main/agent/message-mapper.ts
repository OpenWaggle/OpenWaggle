import type { Message, MessagePart } from '@shared/types/agent'

/**
 * Simple message shape for TanStack AI — content is always string | null.
 * Using structural typing instead of importing ModelMessage avoids
 * ConstrainedModelMessage type parameter mismatches across providers.
 */
export interface SimpleChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string | null
  toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  toolCallId?: string
}

/**
 * Convert our Message[] to simple ChatMessage[].
 * Handles text, tool_use, and tool_result parts.
 */
export function conversationToMessages(messages: readonly Message[]): SimpleChatMessage[] {
  const result: SimpleChatMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = msg.parts
        .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
      result.push({ role: 'user', content: text })
    } else if (msg.role === 'assistant') {
      const toolCalls = msg.parts
        .filter((p): p is Extract<MessagePart, { type: 'tool-call' }> => p.type === 'tool-call')
        .map((p) => ({
          id: String(p.toolCall.id),
          type: 'function' as const,
          function: {
            name: p.toolCall.name,
            arguments: JSON.stringify(p.toolCall.args),
          },
        }))

      const textParts = msg.parts.filter(
        (p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text',
      )

      const textContent = textParts.map((p) => p.text).join('\n')

      result.push({
        role: 'assistant',
        content: textContent || null,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      })

      // Tool results as separate tool messages
      const toolResults = msg.parts.filter(
        (p): p is Extract<MessagePart, { type: 'tool-result' }> => p.type === 'tool-result',
      )
      for (const tr of toolResults) {
        result.push({
          role: 'tool',
          content: tr.toolResult.result,
          toolCallId: String(tr.toolResult.id),
        })
      }
    }
  }

  return result
}
