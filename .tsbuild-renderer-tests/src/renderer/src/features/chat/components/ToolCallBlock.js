import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { hasConcreteToolOutput } from '@shared/utils/tool-result-state';
import { useEffect, useRef, useState } from 'react';
import { parseToolArgs } from '@/features/chat/lib/tool-args';
import { buildTailPreview, getEditUnifiedDiff, getResultError, getStringArg, getToolResultText, INLINE_DIFF_LINE_LIMIT, } from '@/features/chat/lib/tool-call-block';
import { resolveActionText } from '@/features/chat/lib/tool-display';
import { CollapsedToolPreview, ToolCallHeader } from './ToolCallBlockChrome';
import { CopyButton, ToolArgs, ToolResult, UnifiedDiffView } from './ToolCallBlockParts';
function isToolRunning(state, result, isStreaming) {
    return isStreaming && (state === 'input-streaming' || state === 'executing' || !result);
}
function shouldReadResultText(result, expanded, isRunning, isError) {
    return result !== undefined && (expanded || isRunning || isError);
}
function previewText(enabled, text) {
    return enabled && text.trim() ? buildTailPreview(text) : '';
}
function readableResultText(result, expanded, isRunning, isError) {
    if (!result || !shouldReadResultText(result, expanded, isRunning, isError)) {
        return '';
    }
    return getToolResultText(result.content);
}
function buildToolCallViewModel({ name, args, state, result, isStreaming, expanded, }) {
    const hasConcreteResult = result ? hasConcreteToolOutput(result.content) : false;
    const resultError = getResultError(result);
    const isError = resultError !== null;
    const isRunning = isToolRunning(state, result, isStreaming);
    const awaitingResult = (!result || !hasConcreteResult) && !isRunning;
    const parsedArgs = parseToolArgs(args);
    const diff = result && !isError ? getEditUnifiedDiff(result.content, name) : null;
    const resultText = readableResultText(result, expanded, isRunning, isError);
    return {
        actionText: resolveActionText({ name, args: parsedArgs, awaitingResult, isError, isRunning }),
        awaitingResult,
        branchSourceMessageId: result?.sourceMessageId,
        command: getStringArg(parsedArgs, 'command'),
        diff,
        failedOutputPreview: previewText(!expanded && isError, resultText),
        hasConcreteResult,
        inlineDiffVisible: diff !== null && diff.lines.length <= INLINE_DIFF_LINE_LIMIT,
        isError,
        isRunning,
        parsedArgs,
        path: getStringArg(parsedArgs, 'path'),
        resultError,
        resultText,
        liveOutputPreview: previewText(isRunning, resultText),
    };
}
export function ToolCallBlock({ name, args, state, result, isStreaming = false, onBranchFromMessage, }) {
    const [expanded, setExpanded] = useState(false);
    const startTime = useRef(null);
    const [duration, setDuration] = useState(0);
    const view = buildToolCallViewModel({ name, args, state, result, isStreaming, expanded });
    useEffect(() => {
        if (view.isRunning && !startTime.current) {
            startTime.current = Date.now();
        }
        if (!view.isRunning && startTime.current) {
            setDuration(Date.now() - startTime.current);
            startTime.current = null;
        }
    }, [view.isRunning]);
    return (_jsxs("div", { className: "group/tool", children: [_jsx(ToolCallHeader, { expanded: expanded, duration: duration, result: result, view: view, onBranchFromMessage: onBranchFromMessage, onToggleExpanded: () => setExpanded(!expanded) }), _jsx(CollapsedToolPreview, { view: view, expanded: expanded }), expanded && _jsx(ExpandedToolDetails, { name: name, args: args, result: result, view: view })] }));
}
function ExpandedToolDetails({ name, args, result, view, }) {
    return (_jsxs("div", { className: "ml-5 mt-1 rounded-md border border-border bg-bg-secondary/50 overflow-hidden", children: [_jsx(ExpandedCopyActions, { args: args, view: view }), _jsx(ExpandedDiffSection, { diff: view.diff }), _jsxs("div", { className: "px-3 py-2", children: [_jsx("div", { className: "text-[13px] text-text-tertiary mb-1", children: "Arguments" }), _jsx(ToolArgs, { name: name, args: view.parsedArgs, rawArgs: args, path: view.path })] }), _jsx(ExpandedResultSection, { name: name, result: result, view: view }), _jsx(ExpandedErrorSection, { name: name, result: result, view: view })] }));
}
function ExpandedCopyActions({ args, view, }) {
    return (_jsxs("div", { className: "flex flex-wrap items-center gap-2 border-b border-border px-3 py-2", children: [_jsx(CopyButton, { label: "Copy args", value: args }), view.path && _jsx(CopyButton, { label: "Copy path", value: view.path }), view.command && _jsx(CopyButton, { label: "Copy command", value: view.command }), view.resultText && _jsx(CopyButton, { label: "Copy output", value: view.resultText })] }));
}
function ExpandedDiffSection({ diff }) {
    if (!diff) {
        return null;
    }
    return (_jsx("div", { className: "px-3 py-2", children: _jsx(UnifiedDiffView, { diff: diff }) }));
}
function ExpandedResultSection({ name, result, view, }) {
    if (!view.hasConcreteResult || !result || view.diff || view.isError) {
        return null;
    }
    return (_jsxs("div", { className: "border-t border-border px-3 py-2", children: [_jsx("div", { className: "text-[13px] text-text-tertiary mb-1", children: "Result" }), _jsx(ToolResult, { content: result.content, isError: view.isError, name: name, path: view.path })] }));
}
function ExpandedErrorSection({ name, result, view, }) {
    if (!result || !view.isError) {
        return null;
    }
    return (_jsxs("div", { role: "alert", className: "border-t border-border px-3 py-2", children: [_jsx("div", { className: "text-[13px] text-text-tertiary mb-1", children: "Error" }), _jsx(ToolResult, { content: view.resultError ?? result.content, isError: true, name: name, path: view.path })] }));
}
