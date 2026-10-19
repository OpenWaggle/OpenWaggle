import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { NestedToolCalls } from '@shared/types/tools'
import { CODEMODE_TOOL_NAME } from '@/features/chat/lib/codemode-tool-view'
import { nestedToolCallsView } from '@/features/chat/lib/nested-tool-call-view'
import { isHiddenSessionsToolCallJson } from '@/features/chat/lib/sessions-tool-visibility'
import { parseToolArgs } from '@/features/chat/lib/tool-args'
import type { ToolCallResultPayload } from '@/features/chat/lib/tool-call-block'
import { SESSIONS_TOOL_NAME } from '@/features/chat/lib/tool-labels-sessions'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import { getMcpAppLaunch, McpAppHost } from '@/features/mcp'
import { CommandRepairProposalCard, commandRepairProposalFrom } from '@/features/project-actions'
import { ToolRowSessionContext } from '../hooks/ToolRowSessionContext'
import { CodemodeToolCallBlock } from './CodemodeToolCallBlock'
import { WithNestedToolCalls } from './NestedToolCallList'
import { SessionsToolCallBlock } from './SessionsToolCallBlock'
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
      error?: string
      nestedCalls?: NestedToolCalls
    }
  >
  sessionId: SessionId | null
  isStreaming: boolean
  extensionRegistry?: ExtensionContributionRegistryView | null
  extensionProjectPaths?: readonly string[]
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

/**
 * A tool call's own card. A codemode card shows the script, its output, images and model calls;
 * the tool calls the script made come from Pi's nested call events and record, like any other
 * tool's. A sessions-tool card names the Worker it acts on.
 */
function ToolCallCard({
  part,
  result,
  isStreaming,
  nestedCallsShown,
}: {
  readonly part: ToolCallRouterProps['part']
  readonly result: ToolCallResultPayload | undefined
  readonly isStreaming: boolean
  readonly nestedCallsShown: boolean
}) {
  if (part.name === CODEMODE_TOOL_NAME) {
    return (
      <CodemodeToolCallBlock
        args={part.arguments}
        state={part.state}
        result={result}
        isStreaming={isStreaming}
        nestedCallsShown={nestedCallsShown}
      />
    )
  }
  const Block = part.name === SESSIONS_TOOL_NAME ? SessionsToolCallBlock : ToolCallBlock
  return (
    <Block
      name={part.name}
      args={part.arguments}
      state={part.state}
      result={result}
      isStreaming={isStreaming}
    />
  )
}

export function ToolCallRouter({
  part,
  toolResults,
  sessionId,
  isStreaming,
  extensionRegistry = null,
  extensionProjectPaths = EMPTY_PROJECT_PATHS,
}: ToolCallRouterProps) {
  const finalResult = toolResults.get(part.id)
  if (
    isHiddenSessionsToolCallJson(part.name, part.arguments, part.state, finalResult !== undefined)
  ) {
    return null
  }
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
  const ownCard = (
    <ToolCallCard
      part={part}
      result={visibleResult}
      isStreaming={isStreaming}
      nestedCallsShown={nestedCalls.calls.length > 0}
    />
  )
  const toolCallBlock = (
    <ToolRowSessionContext value={sessionId}>
      <WithNestedToolCalls
        parentName={part.name}
        nestedCalls={nestedCalls}
        isStreaming={isStreaming}
      >
        {ownCard}
      </WithNestedToolCalls>
    </ToolRowSessionContext>
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
