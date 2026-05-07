import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { ToolCallBlock } from './ToolCallBlock'

interface ToolCallRouterProps {
  part: Extract<UIMessage['parts'][number], { type: 'tool-call' }>
  toolResults: Map<
    string,
    { content: unknown; state: string; sourceMessageId?: string; error?: string }
  >
  sessionId: SessionId | null
  isStreaming: boolean
  onBranchFromMessage?: (messageId: string) => void
}

export function ToolCallRouter({
  part,
  toolResults,
  sessionId: _sessionId,
  isStreaming,
  onBranchFromMessage,
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
      onBranchFromMessage={onBranchFromMessage}
    />
  )
}
