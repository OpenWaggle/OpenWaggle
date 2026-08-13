import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MessageSquare, X } from 'lucide-react';
import { formatLineRange } from '@/features/diff-panel/lib/review-comment-payload';
import { Button } from '@/shared/ui/Button';
/**
 * A saved-but-unsent Review comment, shown inline where it is anchored. Marked
 * "Pending" so it is obvious the agent has not received it yet -- the same signal
 * GitLab gives while a review is in progress.
 */
export function PendingComment({ comment, onRemove }) {
    return (_jsxs("div", { className: "sticky left-0 flex w-[min(640px,calc(100cqw-4rem))] max-w-[calc(100cqw-4rem)] flex-col gap-1.5 border-y border-border bg-diff-header-bg px-3 py-2", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx(MessageSquare, { className: "size-3 shrink-0 text-text-tertiary" }), _jsx("span", { className: "text-[11px] text-text-tertiary", children: formatLineRange(comment.startLine, comment.endLine) }), _jsx("span", { className: "rounded-[4px] bg-bg-tertiary px-1 text-[10px] font-medium text-accent", children: "Pending" }), _jsx(Button, { variant: "unstyled", type: "button", onClick: onRemove, "aria-label": "Remove comment", className: "ml-auto flex size-4 items-center justify-center rounded-[4px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary", children: _jsx(X, { className: "size-3" }) })] }), _jsx("p", { className: "whitespace-pre-wrap text-[12px] text-text-secondary", children: comment.content })] }));
}
