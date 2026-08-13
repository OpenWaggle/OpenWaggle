import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { formatLineRange } from '@/features/diff-panel/lib/review-comment-payload';
import { Button } from '@/shared/ui/Button';
import { Textarea } from '@/shared/ui/Textarea';
/**
 * Composer for a new Review comment, mounted in the renderer's annotation slot.
 *
 * Width is bounded in container-query units against the diff's VISIBLE width:
 * the code column is as wide as its longest line, so a full-width comment would
 * push its own actions off-screen.
 */
const TEXTAREA_ROWS = 3;
export function InlineComment({ startLine, endLine, hasPendingReview, onAddSingleComment, onAddToReview, onCancel, }) {
    const [content, setContent] = useState('');
    const trimmed = content.trim();
    const canSubmit = trimmed !== '';
    function handleAddSingle() {
        if (!canSubmit)
            return;
        onAddSingleComment(trimmed);
        setContent('');
    }
    function handleAddToReview() {
        if (!canSubmit)
            return;
        onAddToReview(trimmed);
        setContent('');
    }
    return (_jsxs("div", { className: "sticky left-0 flex w-[min(640px,calc(100cqw-4rem))] max-w-[calc(100cqw-4rem)] flex-col gap-2 border-y border-border bg-diff-header-bg px-3 py-2", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx(MessageSquare, { className: "size-3 shrink-0 text-text-tertiary" }), _jsxs("span", { className: "text-[11px] text-text-tertiary", children: ["Comment on ", formatLineRange(startLine, endLine)] })] }), _jsx(Textarea, { autoFocus: true, value: content, onChange: (event) => setContent(event.target.value), placeholder: "Leave feedback on this change\u2026", rows: TEXTAREA_ROWS, className: "text-[12px]", onKeyDown: (event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        onCancel();
                        return;
                    }
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        if (hasPendingReview)
                            handleAddToReview();
                        else
                            handleAddSingle();
                    }
                } }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(Button, { variant: "unstyled", type: "button", onClick: onCancel, className: "h-[26px] rounded-[5px] px-2 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary", children: "Cancel" }), _jsx(Button, { variant: "unstyled", type: "button", onClick: handleAddSingle, disabled: !canSubmit, className: "h-[26px] rounded-[5px] border border-button-border px-2.5 text-[12px] text-text-secondary transition-opacity hover:bg-bg-hover disabled:opacity-40", children: "Add comment" }), _jsx(Button, { variant: "unstyled", type: "button", onClick: handleAddToReview, disabled: !canSubmit, className: "h-[26px] rounded-[5px] border border-accent bg-diff-stage-bg px-2.5 text-[12px] font-medium text-accent transition-opacity disabled:opacity-40", children: hasPendingReview ? 'Add to review' : 'Start a review' })] })] }));
}
