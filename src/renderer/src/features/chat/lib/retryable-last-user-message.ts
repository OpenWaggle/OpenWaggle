import type { UIMessage } from '@shared/types/chat-ui'

/**
 * The text the error banner's Retry sends again: the last user message's text. A Hive wake row
 * holds the Host's notice, not a request the user made, so a failed wake offers no Retry.
 */
export function retryableLastUserMessage(messages: readonly UIMessage[]) {
  let lastUserMessage: UIMessage | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role === 'user') {
      lastUserMessage = message
      break
    }
  }
  if (!lastUserMessage) {
    return null
  }
  if (lastUserMessage.metadata?.hiveWake) return null

  const textParts: string[] = []
  for (const part of lastUserMessage.parts) {
    if (part.type === 'text') textParts.push(part.content)
  }
  const content = textParts.join('\n')

  return content || null
}
