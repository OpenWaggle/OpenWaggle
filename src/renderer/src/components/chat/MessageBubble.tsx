import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import { AssistantMessageBubble, type WaggleInfo } from './AssistantMessageBubble'
import { UserMessageBubble } from './UserMessageBubble'

interface MessageBubbleProps {
  message: UIMessage
  isStreaming?: boolean
  isRunActive?: boolean
  assistantModel?: SupportedModelId
  sessionId: SessionId | null
  waggle?: WaggleInfo
  hideAgentLabel?: boolean
  onBranchFromMessage?: (messageId: string) => void
  onForkFromMessage?: (messageId: string) => void
}

export function MessageBubble({
  message,
  isStreaming,
  isRunActive,
  assistantModel,
  sessionId,
  waggle,
  hideAgentLabel,
  onBranchFromMessage,
  onForkFromMessage,
}: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <UserMessageBubble
        message={message}
        onBranchFromMessage={onBranchFromMessage}
        onForkFromMessage={onForkFromMessage}
      />
    )
  }

  return (
    <AssistantMessageBubble
      message={message}
      isStreaming={isStreaming}
      isRunActive={isRunActive}
      assistantModel={assistantModel}
      sessionId={sessionId}
      waggle={waggle}
      hideAgentLabel={hideAgentLabel}
      onBranchFromMessage={onBranchFromMessage}
    />
  )
}
