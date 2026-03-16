import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { PlanResponse } from '@shared/types/plan'
import type { QuestionAnswer } from '@shared/types/question'
import type { UIMessage } from '@tanstack/ai-react'
import { AssistantMessageBubble, type WaggleInfo } from './AssistantMessageBubble'
import { UserMessageBubble } from './UserMessageBubble'

interface MessageBubbleProps {
  message: UIMessage
  isStreaming?: boolean
  assistantModel?: SupportedModelId
  conversationId: ConversationId | null
  onAnswerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>
  onRespondToPlan?: (conversationId: ConversationId, response: PlanResponse) => Promise<void>
  waggle?: WaggleInfo
}

export function MessageBubble({
  message,
  isStreaming,
  assistantModel,
  conversationId,
  onRespondToPlan,
  waggle,
}: MessageBubbleProps): React.JSX.Element {
  if (message.role === 'user') {
    return <UserMessageBubble message={message} />
  }

  return (
    <AssistantMessageBubble
      message={message}
      isStreaming={isStreaming}
      assistantModel={assistantModel}
      conversationId={conversationId}
      onRespondToPlan={onRespondToPlan}
      waggle={waggle}
    />
  )
}
