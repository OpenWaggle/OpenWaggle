import type { Conversation } from '@shared/types/conversation'
import { chooseBy } from '@shared/utils/decision'

const MAX_SUMMARY_LENGTH = 3000
const RECENT_MESSAGE_COUNT = 8

export function summarizeConversation(conversation: Conversation): string {
  const recentMessages = conversation.messages.slice(-RECENT_MESSAGE_COUNT)
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
          .case('compaction-event', (value) => `[compacted:${value.data.description}]`)
          .assertComplete()
        if (segment) {
          segments.push(segment)
        }
      }
      return `${message.role.toUpperCase()}: ${segments.join(' ')}`
    })
    .join('\n')

  return rendered.length > MAX_SUMMARY_LENGTH
    ? `${rendered.slice(0, MAX_SUMMARY_LENGTH)}...`
    : rendered
}
