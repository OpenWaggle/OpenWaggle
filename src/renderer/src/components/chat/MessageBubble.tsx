import type { ConversationId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import { AssistantMessageBubble, type WaggleInfo } from './AssistantMessageBubble'
import { UserMessageBubble } from './UserMessageBubble'

interface MessageBubbleProps {
  message: UIMessage
  isStreaming?: boolean
  isRunActive?: boolean
  assistantModel?: SupportedModelId
  conversationId: ConversationId | null
  waggle?: WaggleInfo
  onBranchFromMessage?: (messageId: string) => void
}

export function MessageBubble({
  message,
  isStreaming,
  isRunActive,
  assistantModel,
  conversationId,
  waggle,
  onBranchFromMessage,
}: MessageBubbleProps) {
  if (message.role === 'user') {
    return <UserMessageBubble message={message} onBranchFromMessage={onBranchFromMessage} />
  }

  return (
    <AssistantMessageBubble
      message={message}
      isStreaming={isStreaming}
      isRunActive={isRunActive}
      assistantModel={assistantModel}
      conversationId={conversationId}
      waggle={waggle}
      onBranchFromMessage={onBranchFromMessage}
    />
  )
}
