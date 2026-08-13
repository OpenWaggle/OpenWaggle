import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId, useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { ModalDialog } from '@/shared/ui/ModalDialog';
import { Textarea } from '@/shared/ui/Textarea';
/**
 * Collects an explicit commit message for a commit-bearing stacked git action
 * (review B2): a one-click action must never invent an unreviewed "Update" commit.
 * Uses a native <dialog> for focus trapping, Escape handling, and a11y.
 */
export function CommitMessageDialog({ open, fileCount, onCancel, onConfirm, }) {
    const headingId = useId();
    const [message, setMessage] = useState('');
    if (!open)
        return null;
    const trimmed = message.trim();
    return (_jsxs(ModalDialog, { labelledBy: headingId, onClose: onCancel, className: "max-w-[420px] p-4", children: [_jsx("h2", { id: headingId, className: "text-[13px] font-medium text-text-primary", children: "Commit message" }), _jsx("p", { className: "mt-1 text-[12px] text-text-tertiary", children: fileCount === 1
                    ? '1 file will be committed.'
                    : `${String(fileCount)} files will be committed.` }), _jsx(Textarea, { autoFocus: true, "aria-label": "Commit message", value: message, onChange: (event) => setMessage(event.target.value), placeholder: "Describe the change", className: "mt-3 h-24 w-full" }), _jsxs("div", { className: "mt-3 flex justify-end gap-2", children: [_jsx(Button, { variant: "unstyled", type: "button", onClick: onCancel, className: "h-8 rounded-lg px-3 text-[13px] text-text-tertiary hover:text-text-secondary", children: "Cancel" }), _jsx(Button, { variant: "unstyled", type: "button", disabled: trimmed.length === 0, onClick: () => onConfirm(trimmed), className: "h-8 rounded-lg bg-accent px-3 text-[13px] text-white disabled:opacity-50", children: "Continue" })] })] }));
}
