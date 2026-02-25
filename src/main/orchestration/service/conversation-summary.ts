import type { Conversation } from '@shared/types/conversation'

const MAX_SUMMARY_LENGTH = 3000
const RECENT_MESSAGE_COUNT = 8

export function summarizeConversation(conversation: Conversation): string {
  const recentMessages = conversation.messages.slice(-RECENT_MESSAGE_COUNT)
  const rendered = recentMessages
    .map((message) => {
      const segments: string[] = []
      for (const part of message.parts) {
        switch (part.type) {
          case 'text':
            segments.push(part.text)
            break
          case 'thinking':
            segments.push('[thinking]')
            break
          case 'tool-call':
            segments.push(`[tool:${part.toolCall.name}]`)
            break
          case 'tool-result':
            segments.push(
              part.toolResult.isError
                ? `[tool-error:${part.toolResult.name}]`
                : `[tool-done:${part.toolResult.name}]`,
            )
            break
        }
      }
      return `${message.role.toUpperCase()}: ${segments.join(' ')}`
    })
    .join('\n')

  return rendered.length > MAX_SUMMARY_LENGTH
    ? `${rendered.slice(0, MAX_SUMMARY_LENGTH)}...`
    : rendered
}
