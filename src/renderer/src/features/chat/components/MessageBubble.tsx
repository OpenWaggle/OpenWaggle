import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import { AssistantMessageBubble, type WaggleInfo } from './AssistantMessageBubble'
import { UserMessageBubble } from './UserMessageBubble'

interface MessageBubbleProps {
  message: UIMessage
  sessionId: SessionId | null
  waggle?: WaggleInfo
  run?: {
    readonly isStreaming?: boolean
    readonly isRunActive?: boolean
    readonly assistantModel?: SupportedModelId
  }
  presentation?: {
    readonly hideAgentLabel?: boolean
  }
  actions?: {
    readonly onBranchFromMessage?: (messageId: string) => void
    readonly onForkFromMessage?: (messageId: string) => void
  }
}

export function MessageBubble({
  message,
  sessionId,
  waggle,
  run,
  presentation,
  actions,
}: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <UserMessageBubble
        message={message}
        onBranchFromMessage={actions?.onBranchFromMessage}
        onForkFromMessage={actions?.onForkFromMessage}
      />
    )
  }

  return (
    <AssistantMessageBubble
      message={message}
      isStreaming={run?.isStreaming}
      isRunActive={run?.isRunActive}
      assistantModel={run?.assistantModel}
      sessionId={sessionId}
      waggle={waggle}
      hideAgentLabel={presentation?.hideAgentLabel}
      onBranchFromMessage={actions?.onBranchFromMessage}
    />
  )
}
