import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { matchBy } from '@diegogbrisa/ts-match';
import { GitBranch, GitCompare } from 'lucide-react';
import React from 'react';
import { Button } from '@/shared/ui/Button';
import { useMessageCollapse } from '../hooks/useMessageCollapse';
import { AgentLabel } from './AgentLabel';
import { CollapsibleDetails } from './CollapsibleDetails';
import { StreamingText } from './StreamingText';
import { ToolCallRouter } from './ToolCallRouter';
const JSON_STRINGIFY_INDENT = 2;
function stringifyToolResultContent(content) {
    if (typeof content === 'string') {
        return content;
    }
    try {
        return JSON.stringify(content, null, JSON_STRINGIFY_INDENT);
    }
    catch {
        return String(content);
    }
}
function StandaloneToolResult({ content, state, }) {
    return (_jsxs("div", { className: "rounded-lg border border-border bg-bg-secondary p-3 text-[13px] text-text-secondary", children: [_jsxs("div", { className: "mb-2 text-[11px] uppercase tracking-wide text-text-tertiary", children: ["Tool result \u00B7 ", state] }), _jsx(StreamingText, { text: stringifyToolResultContent(content) })] }));
}
function BranchFromMessageButton({ messageId, onBranchFromMessage, className, }) {
    return (_jsx(Button, { variant: "unstyled", type: "button", title: "Branch from message", onClick: () => onBranchFromMessage(messageId), className: className, children: _jsx(GitBranch, { className: "size-3.5" }) }));
}
function ViewTurnDiffButton({ messageId, onViewTurnDiff, }) {
    return (_jsx(Button, { variant: "unstyled", type: "button", title: "View turn diff", "aria-label": "View turn diff", onClick: () => onViewTurnDiff(messageId), className: "opacity-0 group-hover/assistant-msg:opacity-100 transition-opacity text-text-muted hover:text-text-secondary", children: _jsx(GitCompare, { className: "size-3.5" }) }));
}
function MessageActionButtons({ messageId, onBranchFromMessage, onViewTurnDiff, className, }) {
    if (!onBranchFromMessage && !onViewTurnDiff)
        return null;
    return (_jsxs("div", { className: className, children: [onViewTurnDiff ? (_jsx(ViewTurnDiffButton, { messageId: messageId, onViewTurnDiff: onViewTurnDiff })) : null, onBranchFromMessage ? (_jsx(BranchFromMessageButton, { messageId: messageId, onBranchFromMessage: onBranchFromMessage, className: "opacity-0 group-hover/assistant-msg:opacity-100 transition-opacity text-text-muted hover:text-text-secondary" })) : null] }));
}
function collectMessageToolState(message) {
    const toolResults = new Map();
    const messageToolCallIds = new Set();
    for (const part of message.parts) {
        if (part.type === 'tool-call') {
            messageToolCallIds.add(part.id);
            continue;
        }
        if (part.type !== 'tool-result')
            continue;
        toolResults.set(part.toolCallId, {
            content: part.content,
            state: part.state,
            sourceMessageId: part.sourceMessageId,
            error: part.error,
        });
    }
    return { toolResults, messageToolCallIds };
}
export function AssistantMessageBubble({ message, runtime, run, waggle, presentation, actions, }) {
    const isStreaming = run?.isStreaming;
    const isRunActive = run?.isRunActive;
    const assistantModel = run?.assistantModel;
    const hideAgentLabel = presentation?.hideAgentLabel;
    const onBranchFromMessage = actions?.onBranchFromMessage;
    const onViewTurnDiff = actions?.onViewTurnDiff;
    const collapse = useMessageCollapse(message, isStreaming, isRunActive, !!waggle);
    const { toolResults, messageToolCallIds } = collectMessageToolState(message);
    return (_jsxs("div", { className: "group/assistant-msg relative w-full", children: [hideAgentLabel ? (_jsx(MessageActionButtons, { messageId: message.id, onBranchFromMessage: onBranchFromMessage, onViewTurnDiff: onViewTurnDiff, className: "absolute right-0 top-0 flex items-center gap-1" })) : null, _jsxs("div", { className: "flex flex-col gap-2", children: [!hideAgentLabel ? (_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx(AgentLabel, { assistantModel: assistantModel, waggle: waggle }), _jsx(MessageActionButtons, { messageId: message.id, onBranchFromMessage: onBranchFromMessage, onViewTurnDiff: onViewTurnDiff, className: "ml-auto flex items-center gap-1" })] })) : null, message.parts.map((part, i) => {
                        const divider = collapse.canCollapseDetails && i === collapse.lastRenderableTextPartIndex ? (_jsx(CollapsibleDetails, { showDetails: collapse.showDetails, collapseLabel: collapse.collapseLabel, onToggle: collapse.toggleDetails }, `${message.id}-divider`)) : null;
                        const content = !collapse.renderAllParts && i !== collapse.lastRenderableTextPartIndex
                            ? null
                            : matchBy(part, 'type')
                                .with('text', (value) => value.content.trim() ? (_jsx(StreamingText, { text: value.content, isStreaming: !!isStreaming }, `${message.id}-text-${String(i)}`)) : null)
                                .with('tool-call', (value) => (_jsx(ToolCallRouter, { part: value, toolResults: toolResults, sessionId: runtime.sessionId, isStreaming: !!isStreaming, extensionRegistry: runtime.extensions.registry, extensionProjectPaths: runtime.extensions.projectPaths, onBranchFromMessage: onBranchFromMessage }, `tool-${value.id}`)))
                                .with('thinking', (value) => value.content.trim() ? (_jsx(StreamingText, { text: value.content, isStreaming: !!isStreaming, className: "prose-thinking italic" }, `${message.id}-thinking-${value.stepId ?? String(i)}`)) : null)
                                .with('tool-result', (value) => messageToolCallIds.has(value.toolCallId) ? null : (_jsx(StandaloneToolResult, { content: value.content, state: value.state })))
                                .otherwise(() => null);
                        if (divider !== null || content !== null) {
                            return (_jsxs(React.Fragment, { children: [divider, content] }, `${message.id}-part-${String(i)}`));
                        }
                        return null;
                    })] })] }));
}
