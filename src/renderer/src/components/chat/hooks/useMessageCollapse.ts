import type { UIMessage } from '@tanstack/ai-react'
import { useState } from 'react'
import {
  countToolCallParts,
  getLastRenderableTextPartIndex,
  hasRenderableTextPartBeforeIndex,
} from '../message-bubble-utils'

export interface UseMessageCollapseResult {
  canCollapseToSynthesis: boolean
  showDetails: boolean
  toggleDetails: () => void
  collapseLabel: string
  lastRenderableTextPartIndex: number
  renderAllParts: boolean
}

export function useMessageCollapse(
  message: UIMessage,
  isStreaming: boolean | undefined,
  isWaggle?: boolean,
): UseMessageCollapseResult {
  const collapseStateKey = `${message.id}:${isStreaming ? 'streaming' : 'completed'}`
  const [expandedStateKey, setExpandedStateKey] = useState<string | null>(null)

  const lastRenderableTextPartIndex = getLastRenderableTextPartIndex(message.parts)
  const toolCallCount = countToolCallParts(message.parts)
  const hasEarlierRenderableTextParts = hasRenderableTextPartBeforeIndex(
    message.parts,
    lastRenderableTextPartIndex,
  )
  // Waggle segments represent individual agent turns — never collapse them to synthesis.
  // Each agent's full response (including tool calls) should always be visible.
  const canCollapseToSynthesis =
    !isWaggle &&
    !isStreaming &&
    lastRenderableTextPartIndex >= 0 &&
    (toolCallCount > 0 || hasEarlierRenderableTextParts)
  const showDetails = expandedStateKey === collapseStateKey
  const renderAllParts = !!isStreaming || showDetails || !canCollapseToSynthesis
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
    canCollapseToSynthesis,
    showDetails,
    toggleDetails,
    collapseLabel,
    lastRenderableTextPartIndex,
    renderAllParts,
  }
}
