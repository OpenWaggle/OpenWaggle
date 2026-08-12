import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { parseToolArgs } from '@/features/chat/lib/tool-args'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import { getMcpAppLaunch, McpAppHost } from '@/features/mcp'
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
  sessionId,
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
  const appLaunch = finalResult
    ? getMcpAppLaunch(finalResult.content, parseToolArgs(part.arguments))
    : null
  const withMcpApp = appLaunch ? (
    <div className="space-y-3">
      {toolCallBlock}
      <McpAppHost
        descriptor={appLaunch.descriptor}
        projectPath={extensionProjectPaths[0] ?? null}
        sessionId={sessionId}
        initialArguments={appLaunch.initialArguments}
        initialResult={appLaunch.initialResult}
      />
    </div>
  ) : (
    toolCallBlock
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
        fallback={withMcpApp}
        projectPaths={extensionProjectPaths}
        registry={extensionRegistry}
      />
    )
  }

  return withMcpApp
}
