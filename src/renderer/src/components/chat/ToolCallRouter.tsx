import type { ConversationId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { ToolCallBlock } from './ToolCallBlock'

interface ToolCallRouterProps {
  part: Extract<UIMessage['parts'][number], { type: 'tool-call' }>
  toolResults: Map<string, { content: unknown; state: string; error?: string }>
  conversationId: ConversationId | null
  isStreaming: boolean
}

export function ToolCallRouter({
  part,
  toolResults,
  conversationId: _conversationId,
  isStreaming,
}: ToolCallRouterProps) {
  const finalResult = toolResults.get(part.id)
  const visibleResult =
    finalResult ??
    (part.partialOutput === undefined
      ? undefined
      : { content: part.partialOutput, state: 'partial' })

  return (
    <ToolCallBlock
      name={part.name}
      args={part.arguments}
      state={part.state}
      result={visibleResult}
      isStreaming={isStreaming}
    />
  )
}
