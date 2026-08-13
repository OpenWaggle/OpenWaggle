import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Check, ChevronRight, GitBranch, Loader2, X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { formatDuration } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { UnifiedDiffView } from './ToolCallBlockParts';
export function ToolCallHeader({ expanded, duration, result, view, onBranchFromMessage, onToggleExpanded, }) {
    return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs(Button, { variant: "unstyled", type: "button", "aria-expanded": expanded, "aria-label": `${view.actionText} — ${expanded ? 'collapse' : 'expand'} details`, onClick: onToggleExpanded, className: "flex min-w-0 flex-1 items-center gap-2 py-0.5 text-[13px] transition-colors", children: [_jsx(ToolStatusIcon, { view: view, result: result }), _jsx(ToolActionLabel, { view: view, result: result }), _jsx(ToolDiffSummary, { view: view }), duration > 0 && !view.isRunning && (_jsx("span", { className: "text-[12px] text-text-muted shrink-0", children: formatDuration(duration) })), _jsx(ChevronRight, { className: cn('ml-auto size-3 text-text-muted shrink-0 transition-transform', 'invisible group-hover/tool:visible', expanded && 'visible rotate-90') })] }), _jsx(BranchFromToolButton, { view: view, onBranchFromMessage: onBranchFromMessage })] }));
}
function ToolStatusIcon({ view, result, }) {
    if (view.isRunning) {
        return (_jsx(Loader2, { role: "status", "aria-label": "Running", className: "size-3.5 text-text-tertiary animate-spin shrink-0" }));
    }
    if (view.hasConcreteResult && result && !view.isError) {
        return _jsx(Check, { className: "size-3.5 text-text-muted shrink-0" });
    }
    if (result && view.isError) {
        return _jsx(X, { className: "size-3.5 text-error/80 shrink-0" });
    }
    return null;
}
function ToolActionLabel({ view, result, }) {
    return (_jsx("span", { className: cn('truncate', view.isRunning && 'text-text-tertiary', view.hasConcreteResult && result && !view.isError && 'text-text-muted', result && view.isError && 'text-error/80'), children: view.actionText }));
}
function ToolDiffSummary({ view }) {
    if (!view.diff) {
        return null;
    }
    return (_jsxs("span", { className: "flex items-center gap-1 text-[12px] shrink-0", children: [_jsxs("span", { className: "text-success", children: ["+", view.diff.additions] }), _jsxs("span", { className: "text-error", children: ["-", view.diff.deletions] })] }));
}
function BranchFromToolButton({ view, onBranchFromMessage, }) {
    if (!view.branchSourceMessageId || !onBranchFromMessage) {
        return null;
    }
    return (_jsx(Button, { variant: "unstyled", type: "button", title: "Branch from tool result", onClick: () => onBranchFromMessage(view.branchSourceMessageId ?? ''), className: "opacity-0 text-text-muted transition-opacity hover:text-text-secondary group-hover/tool:opacity-100 focus:opacity-100", children: _jsx(GitBranch, { className: "size-3.5" }) }));
}
export function CollapsedToolPreview({ view, expanded, }) {
    if (expanded) {
        return null;
    }
    return (_jsxs(_Fragment, { children: [view.inlineDiffVisible && view.diff && (_jsx("div", { className: "ml-5 mt-1", children: _jsx(UnifiedDiffView, { diff: view.diff, compact: true }) })), view.liveOutputPreview && _jsx(ToolPreview, { text: view.liveOutputPreview, tone: "muted" }), view.failedOutputPreview && _jsx(ToolPreview, { text: view.failedOutputPreview, tone: "error" })] }));
}
function ToolPreview({ text, tone }) {
    return (_jsx("pre", { className: cn('ml-5 mt-1 overflow-hidden rounded-md px-3 py-2 text-[12px] font-mono whitespace-pre-wrap break-words', tone === 'error'
            ? 'max-h-[160px] border border-error/20 bg-error/5 text-error'
            : 'max-h-[120px] bg-bg-secondary/60 text-text-tertiary'), children: text }));
}
