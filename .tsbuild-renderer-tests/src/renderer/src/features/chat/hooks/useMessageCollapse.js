import { useState } from 'react';
import { countToolCallParts, getLastRenderableTextPartIndex, hasRenderableTextPartBeforeIndex, } from '../lib/message-bubble-utils';
export function useMessageCollapse(message, isStreaming, isRunActive, isWaggle) {
    const collapseStateKey = message.id;
    const [expandedStateKey, setExpandedStateKey] = useState(null);
    const lastRenderableTextPartIndex = getLastRenderableTextPartIndex(message.parts);
    const toolCallCount = countToolCallParts(message.parts);
    const hasEarlierRenderableTextParts = hasRenderableTextPartBeforeIndex(message.parts, lastRenderableTextPartIndex);
    const hasThinkingParts = message.parts.some((part) => part.type === 'thinking' && part.content.trim().length > 0);
    // Waggle messages represent individual agent turns, so each turn stays fully visible.
    // Each agent's full response (including tool calls) should always be visible.
    // Collapse is deferred until the entire agent run finishes (isRunActive = false),
    // not just when the individual message stream ends, to prevent tools from
    // collapsing while Pi is still processing queued turns or tool updates.
    const canCollapseDetails = !isWaggle &&
        !isRunActive &&
        !hasThinkingParts &&
        lastRenderableTextPartIndex >= 0 &&
        (toolCallCount > 0 || hasEarlierRenderableTextParts);
    const showDetails = expandedStateKey === collapseStateKey;
    const renderAllParts = !!isStreaming || !!isRunActive || showDetails || !canCollapseDetails;
    const collapseLabel = toolCallCount > 0
        ? `Show ${String(toolCallCount)} tool ${toolCallCount === 1 ? 'call' : 'calls'}`
        : 'Show details';
    function toggleDetails() {
        setExpandedStateKey((currentValue) => currentValue === collapseStateKey ? null : collapseStateKey);
    }
    return {
        canCollapseDetails,
        showDetails,
        toggleDetails,
        collapseLabel,
        lastRenderableTextPartIndex,
        renderAllParts,
    };
}
