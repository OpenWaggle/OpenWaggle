import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import { ToolCallBlock } from './ToolCallBlock'

const JSON_STRINGIFY_INDENT = 2
const EMPTY_PROJECT_PATHS: readonly string[] = []

interface ToolCallRouterProps {
  part: Extract<UIMessage['parts'][number], { type: 'tool-call' }>
  toolResults: Map<
    string,
    { content: unknown; state: string; sourceMessageId?: string; error?: string }
  >
  sessionId: SessionId | null
  isStreaming: boolean
  extensionRegistry?: ExtensionContributionRegistryView | null
  extensionProjectPaths?: readonly string[]
  onBranchFromMessage?: (messageId: string) => void
}

function stringifyToolResultContent(content: unknown) {
  if (typeof content === 'string') {
    return content
  }

  try {
    return JSON.stringify(content, null, JSON_STRINGIFY_INDENT)
  } catch {
    return String(content)
  }
}

export function ToolCallRouter({
  part,
  toolResults,
  sessionId: _sessionId,
  isStreaming,
  extensionRegistry = null,
  extensionProjectPaths = EMPTY_PROJECT_PATHS,
  onBranchFromMessage,
}: ToolCallRouterProps) {
  const finalResult = toolResults.get(part.id)
  const visibleResult =
    finalResult ??
    (part.partialOutput === undefined
      ? undefined
      : { content: part.partialOutput, state: 'partial' })

  const toolCallBlock = (
    <ToolCallBlock
      name={part.name}
      args={part.arguments}
      state={part.state}
      result={visibleResult}
      isStreaming={isStreaming}
      onBranchFromMessage={onBranchFromMessage}
    />
  )

  if (extensionRegistry !== null) {
    return (
      <ExtensionAgentLoopSurface
        input={{
          surface: 'tool',
          toolCall: part,
          ...(visibleResult !== undefined
            ? {
                toolResult: {
                  content: stringifyToolResultContent(visibleResult.content),
                  state: visibleResult.state,
                  ...(visibleResult.error !== undefined ? { error: visibleResult.error } : {}),
                },
              }
            : {}),
        }}
        fallback={toolCallBlock}
        projectPaths={extensionProjectPaths}
        registry={extensionRegistry}
      />
    )
  }

  return toolCallBlock
}
