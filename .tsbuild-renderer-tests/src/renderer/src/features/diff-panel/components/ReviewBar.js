import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MessageSquare, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { Textarea } from '@/shared/ui/Textarea';
/**
 * Docked review bar, modelled on GitLab's floating one but scoped to the panel:
 * the diff lives in the right sidebar, so a viewport-pinned bar would overhang
 * the transcript and composer.
 *
 * Absent until a Review is in progress, so a diff you are only reading carries no
 * extra chrome.
 */
const TEXTAREA_ROWS = 3;
export function ReviewBar({ commentCount, summary, onSummaryChange, onSubmit, onDiscard, }) {
    const [isSubmitOpen, setIsSubmitOpen] = useState(false);
    if (commentCount === 0)
        return null;
    const commentLabel = `${String(commentCount)} pending comment${commentCount === 1 ? '' : 's'}`;
    return (_jsxs("div", { className: "relative shrink-0 border-t border-accent/30 bg-diff-highlight-bg", children: [isSubmitOpen ? (_jsxs("div", { className: "flex flex-col gap-2 border-b border-border px-3 py-2.5", children: [_jsxs("label", { htmlFor: "review-summary", className: "text-[11px] font-medium text-text-secondary", children: ["Overall instructions ", _jsx("span", { className: "text-text-muted", children: "(optional)" })] }), _jsx(Textarea, { id: "review-summary", autoFocus: true, value: summary, onChange: (event) => onSummaryChange(event.target.value), placeholder: "Frame the review for the agent \u2014 e.g. \u201Cthese all need tests first\u201D", rows: TEXTAREA_ROWS, className: "text-[12px]", onKeyDown: (event) => {
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                setIsSubmitOpen(false);
                                return;
                            }
                            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                event.preventDefault();
                                setIsSubmitOpen(false);
                                onSubmit();
                            }
                        } }), _jsxs("div", { className: "flex items-center justify-end gap-2", children: [_jsx(Button, { variant: "unstyled", type: "button", onClick: () => setIsSubmitOpen(false), className: "h-[26px] rounded-[5px] px-2 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary", children: "Back" }), _jsxs(Button, { variant: "unstyled", type: "button", onClick: () => {
                                    setIsSubmitOpen(false);
                                    onSubmit();
                                }, className: "flex h-[26px] items-center gap-1.5 rounded-[5px] border border-accent bg-diff-stage-bg px-2.5 text-[12px] font-medium text-accent", children: [_jsx(Send, { className: "size-3" }), "Send to agent \u00B7 ", commentLabel] })] })] })) : null, _jsxs("div", { className: "flex h-10 items-center justify-between gap-2 px-4", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx(MessageSquare, { className: "size-3.5 text-accent" }), _jsx("span", { className: "text-[12px] font-medium text-text-primary", children: commentLabel })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs(Button, { variant: "unstyled", type: "button", onClick: onDiscard, className: "flex h-[26px] items-center gap-1 rounded-[5px] px-2 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary", children: [_jsx(Trash2, { className: "size-3" }), "Discard review"] }), _jsxs(Button, { variant: "unstyled", type: "button", onClick: () => setIsSubmitOpen((open) => !open), "aria-expanded": isSubmitOpen, className: "flex h-[26px] items-center gap-1.5 rounded-[5px] border border-accent bg-diff-stage-bg px-3 text-[12px] font-medium text-accent", children: [_jsx(Send, { className: "size-3" }), "Submit review"] })] })] })] }));
}
