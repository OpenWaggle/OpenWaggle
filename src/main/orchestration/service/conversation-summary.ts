import { CONVERSATION_SUMMARY } from '@shared/constants/text-processing'
import type { Conversation } from '@shared/types/conversation'
import { chooseBy } from '@shared/utils/decision'

export function summarizeConversation(conversation: Conversation): string {
  const recentMessages = conversation.messages.slice(-CONVERSATION_SUMMARY.RECENT_MESSAGE_COUNT)
  const rendered = recentMessages
    .map((message) => {
      const segments: string[] = []
      for (const part of message.parts) {
        const segment = chooseBy(part, 'type')
          .case('text', (value) => value.text)
          .case('reasoning', () => '[reasoning]')
          .case('tool-call', (value) => `[tool:${value.toolCall.name}]`)
          .case('attachment', () => '')
          .case('tool-result', (value) =>
            value.toolResult.isError
              ? `[tool-error:${value.toolResult.name}]`
              : `[tool-done:${value.toolResult.name}]`,
          )
          .assertComplete()
        if (segment) {
          segments.push(segment)
        }
      }
      return `${message.role.toUpperCase()}: ${segments.join(' ')}`
    })
    .join('\n')

  return rendered.length > CONVERSATION_SUMMARY.MAX_LENGTH
    ? `${rendered.slice(0, CONVERSATION_SUMMARY.MAX_LENGTH)}...`
    : rendered
}
