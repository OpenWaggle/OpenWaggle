import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { NestedToolCalls } from '@shared/types/tools'
import { CODEMODE_TOOL_NAME } from '@/features/chat/lib/codemode-tool-view'
import { nestedToolCallsView } from '@/features/chat/lib/nested-tool-call-view'
import { parseToolArgs } from '@/features/chat/lib/tool-args'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import { getMcpAppLaunch, McpAppHost } from '@/features/mcp'
import { CommandRepairProposalCard, commandRepairProposalFrom } from '@/features/project-actions'
import { CodemodeToolCallBlock } from './CodemodeToolCallBlock'
import { WithNestedToolCalls } from './NestedToolCallList'
import { ToolCallBlock } from './ToolCallBlock'

const JSON_STRINGIFY_INDENT = 2
const EMPTY_PROJECT_PATHS: readonly string[] = []

interface ToolCallRouterProps {
  part: Extract<UIMessage['parts'][number], { type: 'tool-call' }>
  toolResults: Map<
    string,
    {
      content: unknown
      state: string
      sourceMessageId?: string
      error?: string
      nestedCalls?: NestedToolCalls
    }
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

/** An agent's Command repair proposal gets a Review and save card (ADR 0038). */
function repairProposalFor(
  toolName: string,
  result: { readonly content: unknown; readonly state: string } | undefined,
) {
  if (toolName !== 'project_actions' || !result || result.state === 'error') return null
  const proposal = commandRepairProposalFrom(result.content)
  return proposal ? <CommandRepairProposalCard proposal={proposal} /> : null
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

  const nestedCalls = nestedToolCallsView(
    part.nestedCalls,
    finalResult?.nestedCalls,
    finalResult !== undefined || !isStreaming,
  )
  // A codemode card shows the script, its output, images and model calls; the tool calls the
  // script made come from Pi's nested call events and record, like any other tool's.
  const ownCard =
    part.name === CODEMODE_TOOL_NAME ? (
      <CodemodeToolCallBlock
        args={part.arguments}
        state={part.state}
        result={visibleResult}
        isStreaming={isStreaming}
        nestedCallsShown={nestedCalls.calls.length > 0}
      />
    ) : (
      <ToolCallBlock
        name={part.name}
        args={part.arguments}
        state={part.state}
        result={visibleResult}
        isStreaming={isStreaming}
        onBranchFromMessage={onBranchFromMessage}
      />
    )
  const toolCallBlock = (
    <WithNestedToolCalls parentName={part.name} nestedCalls={nestedCalls} isStreaming={isStreaming}>
      {ownCard}
    </WithNestedToolCalls>
  )
  const appLaunch = finalResult
    ? getMcpAppLaunch(finalResult.content, parseToolArgs(part.arguments))
    : null
  const repairProposal = repairProposalFor(part.name, finalResult)
  const withMcpApp = repairProposal ? (
    <div className="space-y-3">
      {toolCallBlock}
      {repairProposal}
    </div>
  ) : appLaunch ? (
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
