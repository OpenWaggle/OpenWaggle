import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { SupportedModelId } from '@shared/types/llm'
import { AssistantMessageBubble, type WaggleInfo } from './AssistantMessageBubble'
import { UserMessageBubble } from './UserMessageBubble'

export interface MessageBubbleRuntime {
  readonly sessionId: SessionId | null
  readonly extensions: {
    readonly registry: ExtensionContributionRegistryView | null
    readonly projectPaths: readonly string[]
  }
}

interface MessageBubbleProps {
  message: UIMessage
  runtime: MessageBubbleRuntime
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
  runtime,
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
      runtime={runtime}
      run={run}
      waggle={waggle}
      presentation={presentation}
      actions={
        actions?.onBranchFromMessage
          ? { onBranchFromMessage: actions.onBranchFromMessage }
          : undefined
      }
    />
  )
}
