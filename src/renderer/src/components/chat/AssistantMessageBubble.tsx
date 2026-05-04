import { matchBy } from '@diegogbrisa/ts-match'
import type { ConversationId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { WaggleAgentColor } from '@shared/types/waggle'
import { GitBranch } from 'lucide-react'
import React from 'react'
import { AGENT_BORDER_LEFT } from '@/lib/agent-colors'
import { cn } from '@/lib/cn'
import { AgentLabel } from './AgentLabel'
import { CollapsibleDetails } from './CollapsibleDetails'
import { useMessageCollapse } from './hooks/useMessageCollapse'
import { StreamingText } from './StreamingText'
import { ToolCallRouter } from './ToolCallRouter'

const JSON_STRINGIFY_INDENT = 2

export interface WaggleInfo {
  agentLabel: string
  agentColor: WaggleAgentColor
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  try {
    return JSON.stringify(content, null, JSON_STRINGIFY_INDENT)
  } catch {
    return String(content)
  }
}

function StandaloneToolResult({
  content,
  state,
}: {
  readonly content: unknown
  readonly state: string
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3 text-[13px] text-text-secondary">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-text-tertiary">
        Tool result · {state}
      </div>
      <StreamingText text={stringifyToolResultContent(content)} />
    </div>
  )
}

interface AssistantMessageBubbleProps {
  message: UIMessage
  isStreaming?: boolean
  isRunActive?: boolean
  assistantModel?: SupportedModelId
  conversationId: ConversationId | null
  waggle?: WaggleInfo
  onBranchFromMessage?: (messageId: string) => void
}

export function AssistantMessageBubble({
  message,
  isStreaming,
  isRunActive,
  assistantModel,
  conversationId,
  waggle,
  onBranchFromMessage,
}: AssistantMessageBubbleProps) {
  const collapse = useMessageCollapse(message, isStreaming, isRunActive, !!waggle)

  const toolResults = new Map<string, { content: unknown; state: string; error?: string }>()
  const messageToolCallIds = new Set<string>()
  for (const part of message.parts) {
    if (part.type === 'tool-call') {
      messageToolCallIds.add(part.id)
      continue
    }

    if (part.type === 'tool-result') {
      toolResults.set(part.toolCallId, {
        content: part.content,
        state: part.state,
        error: part.error,
      })
    }
  }

  return (
    <div
      className={cn(
        'group/assistant-msg relative w-full',
        waggle && `border-l-2 pl-3 ${AGENT_BORDER_LEFT[waggle.agentColor]}`,
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <AgentLabel assistantModel={assistantModel} waggle={waggle} />
          {onBranchFromMessage ? (
            <button
              type="button"
              title="Branch from message"
              onClick={() => onBranchFromMessage(message.id)}
              className="opacity-0 group-hover/assistant-msg:opacity-100 transition-opacity text-text-muted hover:text-text-secondary"
            >
              <GitBranch className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {message.parts.map((part, i) => {
          const divider =
            collapse.canCollapseToSynthesis && i === collapse.lastRenderableTextPartIndex ? (
              <CollapsibleDetails
                key={`${message.id}-divider`}
                showDetails={collapse.showDetails}
                collapseLabel={collapse.collapseLabel}
                onToggle={collapse.toggleDetails}
              />
            ) : null

          const content =
            !collapse.renderAllParts && i !== collapse.lastRenderableTextPartIndex
              ? null
              : matchBy(part, 'type')
                  .with('text', (value) =>
                    value.content.trim() ? (
                      <StreamingText
                        key={`${message.id}-text-${String(i)}`}
                        text={value.content}
                        isStreaming={!!isStreaming}
                      />
                    ) : null,
                  )
                  .with('tool-call', (value) => (
                    <ToolCallRouter
                      key={`tool-${value.id}`}
                      part={value}
                      toolResults={toolResults}
                      conversationId={conversationId}
                      isStreaming={!!isStreaming}
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

          if (divider !== null || content !== null) {
            return (
              <React.Fragment key={`${message.id}-part-${String(i)}`}>
                {divider}
                {content}
              </React.Fragment>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}
