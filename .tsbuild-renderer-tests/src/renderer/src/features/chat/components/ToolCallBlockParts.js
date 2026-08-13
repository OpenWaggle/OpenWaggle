import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertCircle, Clipboard } from 'lucide-react';
import { buildFencedCodeMarkdown, FILE_CONTENT_ARG_KEYS, getToolResultText, getUnifiedDiffLineClassName, inferLanguageFromPath, JSON_STRINGIFY_SPACES, LONG_ARGUMENT_MAX_HEIGHT_PX, LONG_ARGUMENT_PREVIEW_CHARS, RESULT_MAX_HEIGHT_PX, shouldHighlightCode, } from '@/features/chat/lib/tool-call-block';
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { StreamingText } from './StreamingText';
export function CopyButton({ label, value }) {
    const { copied, copy } = useCopyToClipboard();
    if (!value) {
        return null;
    }
    return (_jsxs(Button, { variant: "unstyled", type: "button", className: "inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary", onClick: (event) => {
            event.stopPropagation();
            copy(value);
        }, children: [_jsx(Clipboard, { className: "size-3" }), copied ? 'Copied' : label] }));
}
export function ToolArgs({ name, args, rawArgs, path, }) {
    if (name === 'bash' && typeof args.command === 'string') {
        return (_jsxs("div", { className: "rounded-md bg-bg px-3 py-2 font-mono text-[13px] text-text-secondary", children: [_jsx("span", { className: "text-text-muted select-none", children: "$ " }), args.command] }));
    }
    const entries = Object.entries(args);
    if (entries.length === 0) {
        return (_jsx("pre", { className: "text-[13px] font-mono text-text-secondary bg-bg rounded-md p-2 overflow-x-auto", children: rawArgs || '{}' }));
    }
    return (_jsx("div", { className: "space-y-1", children: entries.map(([key, value]) => (_jsx(ToolArgValue, { name: key, value: value, path: path }, key))) }));
}
function ToolArgValue({ name, value, path, }) {
    const display = typeof value === 'string' ? value : JSON.stringify(value, null, JSON_STRINGIFY_SPACES);
    const isLong = typeof display === 'string' && display.length > LONG_ARGUMENT_PREVIEW_CHARS;
    return (_jsxs("div", { children: [_jsxs("span", { className: "text-[13px] text-text-tertiary", children: [name, ": "] }), isLong && typeof value === 'string' && FILE_CONTENT_ARG_KEYS.has(name) ? (_jsx(HighlightedFileContent, { content: value, language: inferLanguageFromPath(path), maxHeight: LONG_ARGUMENT_MAX_HEIGHT_PX })) : isLong ? (_jsx("pre", { className: "mt-0.5 text-[13px] font-mono text-text-secondary bg-bg rounded-md p-2 overflow-x-auto overflow-y-auto", style: { maxHeight: LONG_ARGUMENT_MAX_HEIGHT_PX }, children: display })) : (_jsx("span", { className: "text-[13px] font-mono text-text-secondary", children: display }))] }));
}
function HighlightedFileContent({ content, language, maxHeight, }) {
    if (!shouldHighlightCode(content)) {
        return (_jsxs("div", { children: [_jsx("div", { className: "mb-1 text-[12px] text-text-muted", children: "Large file preview shown without syntax highlighting to keep the UI responsive." }), _jsx("pre", { className: "text-[13px] font-mono text-text-secondary bg-bg rounded-md p-2 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words", style: { maxHeight }, children: content })] }));
    }
    return (_jsx("div", { className: "tool-result-code overflow-y-auto", style: { maxHeight }, children: _jsx(StreamingText, { text: buildFencedCodeMarkdown(content, language), className: "[&_pre]:max-h-none [&_pre]:text-[13px] [&_pre]:leading-relaxed" }) }));
}
export function ToolResult({ content, isError, name, path, }) {
    const displayContent = getToolResultText(content);
    if (isError) {
        return (_jsx("div", { className: "rounded-md border border-error/20 bg-error/5 px-3 py-2", children: _jsxs("div", { className: "flex items-start gap-2", children: [_jsx(AlertCircle, { className: "size-3.5 text-error shrink-0 mt-0.5" }), _jsx("pre", { className: "text-[13px] font-mono text-error whitespace-pre-wrap break-words flex-1", children: displayContent })] }) }));
    }
    if (name === 'read' && displayContent) {
        return (_jsx(HighlightedFileContent, { content: displayContent, language: inferLanguageFromPath(path), maxHeight: RESULT_MAX_HEIGHT_PX }));
    }
    return (_jsx("pre", { className: "text-[13px] font-mono text-text-secondary bg-bg rounded-md p-2 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words", style: { maxHeight: RESULT_MAX_HEIGHT_PX }, children: displayContent }));
}
export function UnifiedDiffView({ diff, compact = false, }) {
    return (_jsxs("div", { className: "rounded-md border border-border overflow-hidden text-[12px] font-mono", children: [_jsxs("div", { className: "flex items-center justify-between bg-bg-secondary px-3 py-1.5 border-b border-border", children: [_jsx("span", { className: "text-text-secondary", children: "Diff" }), _jsxs("div", { className: "flex items-center gap-2 shrink-0 ml-2", children: [diff.additions > 0 && _jsxs("span", { className: "text-success", children: ["+", diff.additions] }), diff.deletions > 0 && _jsxs("span", { className: "text-error", children: ["-", diff.deletions] })] })] }), _jsx("div", { className: cn('overflow-x-auto bg-bg', compact && 'max-h-[220px] overflow-y-hidden'), children: diff.lines.map((line) => (_jsx("div", { className: cn('flex whitespace-pre px-3', getUnifiedDiffLineClassName(line.type)), children: line.content }, line.lineIndex))) })] }));
}
