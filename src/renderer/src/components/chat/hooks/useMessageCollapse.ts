import type { UIMessage } from '@tanstack/ai-react'
import { useState } from 'react'
import {
  countToolCallParts,
  getLastRenderableTextPartIndex,
  hasRenderableTextPartBeforeIndex,
  hasUnansweredBlockingToolCall,
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
  // Waggle segments represent individual agent turns — never collapse them to synthesis.
  // Each agent's full response (including tool calls) should always be visible.
  // Never collapse messages with unanswered blocking tool calls (proposePlan /
  // askUser). These require user interaction (Approve/Revise, answer questions)
  // and must remain visible — especially after app restart when isStreaming is
  // false but the user still needs to respond.
  // Collapse is deferred until the entire agent run finishes (isRunActive = false),
  // not just when the individual message stream ends, to prevent tools from
  // collapsing mid-run during continuation messages.
  const canCollapseToSynthesis =
    !isWaggle &&
    !isRunActive &&
    !hasUnansweredBlockingToolCall(message.parts) &&
    lastRenderableTextPartIndex >= 0 &&
    (toolCallCount > 0 || hasEarlierRenderableTextParts)
  const showDetails = expandedStateKey === collapseStateKey
  const renderAllParts = !!isStreaming || !!isRunActive || showDetails || !canCollapseToSynthesis
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
