import { type ConversationId, MessageId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { PlanResponse } from '@shared/types/plan'
import type { WaggleAgentColor } from '@shared/types/waggle'
import { chooseBy } from '@shared/utils/decision'
import type { UIMessage } from '@tanstack/ai-react'
import { Pin } from 'lucide-react'
import React from 'react'
import { useOrchestrationTaskStatus } from '@/hooks/useOrchestrationTaskStatus'
import { AGENT_BORDER_LEFT } from '@/lib/agent-colors'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { useContextStore } from '@/stores/context-store'
import { AgentLabel } from './AgentLabel'
import { CollapsibleDetails } from './CollapsibleDetails'
import { useMessageCollapse } from './hooks/useMessageCollapse'
import { StreamingText } from './StreamingText'
import { ToolCallRouter } from './ToolCallRouter'

export interface WaggleInfo {
  agentLabel: string
  agentColor: WaggleAgentColor
}

interface AssistantMessageBubbleProps {
  message: UIMessage
  isStreaming?: boolean
  isRunActive?: boolean
  assistantModel?: SupportedModelId
  conversationId: ConversationId | null
  onRespondToPlan?: (conversationId: ConversationId, response: PlanResponse) => Promise<void>
  waggle?: WaggleInfo
}

export function AssistantMessageBubble({
  message,
  isStreaming,
  isRunActive,
  assistantModel,
  conversationId,
  onRespondToPlan,
  waggle,
}: AssistantMessageBubbleProps) {
  const collapse = useMessageCollapse(message, isStreaming, isRunActive, !!waggle)
  const taskStatusLookup = useOrchestrationTaskStatus(conversationId)

  const toolResults = new Map<string, { content: unknown; state: string; error?: string }>()
  for (const part of message.parts) {
    if (part.type === 'tool-result') {
      toolResults.set(part.toolCallId, {
        content: part.content,
        state: part.state,
        error: part.error,
      })
    }
  }

  const isPinned = useContextStore(
    (s) => s.snapshot?.pinnedMessageIds?.includes(message.id) ?? false,
  )

  function handleTogglePin() {
    if (!conversationId) return
    if (isPinned) {
      void api.removePinByMessage(conversationId, message.id)
    } else {
      const text = message.parts
        .filter(
          (p): p is Extract<(typeof message.parts)[number], { type: 'text' }> => p.type === 'text',
        )
        .map((p) => p.content)
        .join('\n')
      void api.addPin(conversationId, {
        type: 'message',
        content: text,
        messageId: MessageId(message.id),
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
        <AgentLabel assistantModel={assistantModel} waggle={waggle} />

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
              : chooseBy(part, 'type')
                  .case('text', (value) =>
                    value.content.trim() ? (
                      <StreamingText
                        key={`${message.id}-text-${String(i)}`}
                        text={value.content}
                        isStreaming={!!isStreaming}
                      />
                    ) : null,
                  )
                  .case('tool-call', (value) => (
                    <ToolCallRouter
                      key={`tool-${value.id}`}
                      part={value}
                      toolResults={toolResults}
                      conversationId={conversationId}
                      onRespondToPlan={onRespondToPlan}
                      isStreaming={!!isStreaming}
                      taskStatusLookup={taskStatusLookup}
                    />
                  ))
                  .case('thinking', () => null)
                  .case('tool-result', () => null)
                  .catchAll(() => null)

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

      {/* Pin action on hover */}
      {!isStreaming && (
        <button
          type="button"
          onClick={handleTogglePin}
          className={cn(
            'absolute -bottom-5 left-0 flex items-center gap-1 text-[12px] transition-all cursor-pointer',
            isPinned
              ? 'text-accent opacity-100'
              : 'text-text-muted hover:text-text-secondary opacity-0 group-hover/assistant-msg:opacity-100',
          )}
          title={isPinned ? 'Unpin message' : 'Pin message'}
        >
          <Pin className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
