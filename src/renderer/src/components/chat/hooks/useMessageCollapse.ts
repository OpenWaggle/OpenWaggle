import type { UIMessage } from '@shared/types/chat-ui'
import { useState } from 'react'
import {
  countToolCallParts,
  getLastRenderableTextPartIndex,
  hasRenderableTextPartBeforeIndex,
} from '../message-bubble-utils'

export interface UseMessageCollapseResult {
  canCollapseDetails: boolean
  showDetails: boolean
  toggleDetails: () => void
  collapseLabel: string
  lastRenderableTextPartIndex: number
  renderAllParts: boolean
}

export function useMessageCollapse(
  message: UIMessage,
  isStreaming: boolean | undefined,
  isRunActive: boolean | undefined,
  isWaggle?: boolean,
): UseMessageCollapseResult {
  const collapseStateKey = message.id
  const [expandedStateKey, setExpandedStateKey] = useState<string | null>(null)

  const lastRenderableTextPartIndex = getLastRenderableTextPartIndex(message.parts)
  const toolCallCount = countToolCallParts(message.parts)
  const hasEarlierRenderableTextParts = hasRenderableTextPartBeforeIndex(
    message.parts,
    lastRenderableTextPartIndex,
  )
  const hasThinkingParts = message.parts.some(
    (part) => part.type === 'thinking' && part.content.trim().length > 0,
  )
  // Waggle messages represent individual agent turns, so each turn stays fully visible.
  // Each agent's full response (including tool calls) should always be visible.
  // Collapse is deferred until the entire agent run finishes (isRunActive = false),
  // not just when the individual message stream ends, to prevent tools from
  // collapsing while Pi is still processing queued turns or tool updates.
  const canCollapseDetails =
    !isWaggle &&
    !isRunActive &&
    !hasThinkingParts &&
    lastRenderableTextPartIndex >= 0 &&
    (toolCallCount > 0 || hasEarlierRenderableTextParts)
  const showDetails = expandedStateKey === collapseStateKey
  const renderAllParts = !!isStreaming || !!isRunActive || showDetails || !canCollapseDetails
  const collapseLabel =
    toolCallCount > 0
      ? `Show ${String(toolCallCount)} tool ${toolCallCount === 1 ? 'call' : 'calls'}`
      : 'Show details'

  function toggleDetails(): void {
    setExpandedStateKey((currentValue) =>
      currentValue === collapseStateKey ? null : collapseStateKey,
    )
  }

  return {
    canCollapseDetails,
    showDetails,
    toggleDetails,
    collapseLabel,
    lastRenderableTextPartIndex,
    renderAllParts,
  }
}
