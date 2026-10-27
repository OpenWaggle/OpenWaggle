import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { SupportedModelId } from '@shared/types/llm'
import type { NestedToolCalls } from '@shared/types/tools'
import type { WaggleAgentColor } from '@shared/types/waggle'
import { GitCompare } from 'lucide-react'
import React from 'react'
import { SessionMessageImages } from '@/features/session-summary'
import { Button } from '@/shared/ui/Button'
import { StructuredPayload } from '@/shared/ui/StructuredPayload'
import { getLastRenderableTextPartIndex } from '../lib/message-bubble-utils'
import { showsOnlyHiddenSessionsToolCalls } from '../lib/sessions-tool-visibility'
import { useLiveStreamMessage } from '../state/live-stream-message-store'
import { AgentLabel } from './AgentLabel'
import { StreamingText } from './StreamingText'
import { ToolCallRouter } from './ToolCallRouter'

export interface WaggleInfo {
  agentLabel: string
  agentColor: WaggleAgentColor
}

function StandaloneToolResult({
  content,
  state,
}: {
  readonly content: unknown
  readonly state: string
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3 text-sm text-text-secondary">
      <div className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
        Tool result · {state}
      </div>
      {typeof content === 'string' ? (
        <StreamingText text={content} />
      ) : (
        <StructuredPayload value={content} className="max-h-80" />
      )}
    </div>
  )
}

function ViewTurnDiffButton({
  messageId,
  onViewTurnDiff,
}: {
  readonly messageId: string
  readonly onViewTurnDiff: (messageId: string) => void
}) {
  return (
    <Button
      variant="unstyled"
      type="button"
      title="View turn diff"
      aria-label="View turn diff"
      onClick={() => onViewTurnDiff(messageId)}
      className="opacity-0 group-hover/assistant-msg:opacity-100 transition-opacity text-text-muted hover:text-text-secondary"
    >
      <GitCompare className="size-3.5" />
    </Button>
  )
}

interface MessageActions {
  readonly onViewTurnDiff?: (messageId: string) => void
}

/**
 * The header's View turn diff, for a message that anchors a turn's diff but is not its reply. A
 * reply's actions sit at the end of its turn (`TurnReplyActions`), and a folded turn shows its diff
 * in the changed-files card.
 */
function MessageActionButtons({
  messageId,
  actions,
  className,
  turnFolded,
}: {
  readonly messageId: string
  readonly actions: MessageActions
  readonly className: string
  readonly turnFolded?: boolean
}) {
  const onViewTurnDiff = turnFolded ? undefined : actions.onViewTurnDiff
  if (!onViewTurnDiff) return null
  return (
    <div className={className}>
      <ViewTurnDiffButton messageId={messageId} onViewTurnDiff={onViewTurnDiff} />
    </div>
  )
}

type ToolResultEntry = {
  content: unknown
  state: string
  error?: string
  nestedCalls?: NestedToolCalls
}

function collectMessageToolState(message: UIMessage) {
  const toolResults = new Map<string, ToolResultEntry>()
  const messageToolCallIds = new Set<string>()
  for (const part of message.parts) {
    if (part.type === 'tool-call') {
      messageToolCallIds.add(part.id)
      continue
    }
    if (part.type !== 'tool-result') continue
    toolResults.set(part.toolCallId, {
      content: part.content,
      state: part.state,
      error: part.error,
      nestedCalls: part.nestedCalls,
    })
  }
  return { toolResults, messageToolCallIds }
}

interface AssistantMessageBubbleProps {
  message: UIMessage
  runtime: {
    readonly sessionId: SessionId | null
    readonly extensions: {
      readonly registry: ExtensionContributionRegistryView | null
      readonly projectPaths: readonly string[]
    }
  }
  run?: {
    readonly isStreaming?: boolean
    readonly isRunActive?: boolean
    readonly assistantModel?: SupportedModelId
  }
  waggle?: WaggleInfo
  presentation?: {
    readonly hideAgentLabel?: boolean
    /** Terminal message of a folded turn: render only its final text part. */
    readonly turnFolded?: boolean
  }
  actions?: MessageActions
}

export function AssistantMessageBubble({
  message: shownMessage,
  runtime,
  run,
  waggle,
  presentation,
  actions,
}: AssistantMessageBubbleProps) {
  const isStreaming = run?.isStreaming
  // Only this bubble re-renders for a streamed token; the transcript commits the message later.
  const message = useLiveStreamMessage(runtime.sessionId, shownMessage)
  const isRunActive = run?.isRunActive
  const assistantModel = run?.assistantModel
  const hideAgentLabel = presentation?.hideAgentLabel
  const turnFolded = presentation?.turnFolded === true
  // ADR 0034: the turn fold owns collapsing. While active or in an expanded
  // turn every part renders; a folded terminal message renders only its final text.
  const renderAllParts = !turnFolded || !!isStreaming || !!isRunActive
  const lastRenderableTextPartIndex = getLastRenderableTextPartIndex(message.parts)

  const { toolResults, messageToolCallIds } = collectMessageToolState(message)
  if (showsOnlyHiddenSessionsToolCalls(message.parts)) return null

  return (
    <div className="group/assistant-msg relative w-full">
      {hideAgentLabel ? (
        <MessageActionButtons
          messageId={message.id}
          actions={actions ?? {}}
          className="absolute right-0 top-0 flex items-center gap-1"
          turnFolded={turnFolded}
        />
      ) : null}
      <div className="flex flex-col gap-2">
        {!hideAgentLabel ? (
          <div className="flex items-center justify-between gap-2">
            <AgentLabel assistantModel={assistantModel} waggle={waggle} />
            <MessageActionButtons
              messageId={message.id}
              actions={actions ?? {}}
              className="ml-auto flex items-center gap-1"
              turnFolded={turnFolded}
            />
          </div>
        ) : null}

        <SessionMessageImages messageId={message.metadata?.sessionNodeId ?? message.id} />

        {message.parts.map((part, i) => {
          const content =
            !renderAllParts && i !== lastRenderableTextPartIndex
              ? null
              : matchBy(part, 'type')
                  .with('text', (value) =>
                    value.content.trim() ? (
                      <StreamingText
                        key={`${message.id}-text-${String(i)}`}
                        text={value.content}
                        isStreaming={!!isStreaming}
                        visualizationSessionId={
                          message.metadata?.visualizationSessionId ?? runtime.sessionId
                        }
                        visualizationInteractionSessionId={runtime.sessionId}
                      />
                    ) : null,
                  )
                  .with('tool-call', (value) => (
                    <ToolCallRouter
                      key={`tool-${value.id}`}
                      part={value}
                      toolResults={toolResults}
                      sessionId={runtime.sessionId}
                      isStreaming={!!isStreaming}
                      extensionRegistry={runtime.extensions.registry}
                      extensionProjectPaths={runtime.extensions.projectPaths}
                    />
                  ))
                  .with('thinking', (value) =>
                    value.content.trim() ? (
                      <StreamingText
                        key={`${message.id}-thinking-${value.stepId ?? String(i)}`}
                        text={value.content}
                        isStreaming={!!isStreaming}
                        className="prose-thinking italic"
                      />
                    ) : null,
                  )
                  .with('tool-result', (value) =>
                    messageToolCallIds.has(value.toolCallId) ? null : (
                      <StandaloneToolResult content={value.content} state={value.state} />
                    ),
                  )
                  .otherwise(() => null)

          if (content !== null) {
            return (
              <React.Fragment key={`${message.id}-part-${String(i)}`}>{content}</React.Fragment>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}
