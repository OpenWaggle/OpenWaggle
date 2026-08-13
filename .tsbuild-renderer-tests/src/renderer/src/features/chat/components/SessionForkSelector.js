import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { GitBranch } from 'lucide-react';
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
const PREVIEW_LIMIT = 180;
function previewText(text) {
    return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT).trim()}...` : text;
}
export function SessionForkSelector({ open, targets, onSelect, onClose, }) {
    useEscapeHotkey(onClose, { enabled: open });
    if (!open) {
        return null;
    }
    return (_jsx("div", { className: "fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4", children: _jsxs("section", { className: "w-full max-w-[520px] rounded-xl border border-border-light bg-bg-secondary p-4 shadow-2xl", children: [_jsxs("div", { className: "flex items-start gap-3", children: [_jsx("span", { className: "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent", children: _jsx(GitBranch, { className: "size-4" }) }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("h3", { className: "text-sm font-semibold text-text-primary", children: "Fork to new session" }), _jsx("p", { className: "mt-1 text-[12px] text-text-tertiary", children: "Select a previous user message. The new session starts before it and prefills the composer with that text." })] })] }), _jsx("div", { className: "mt-4 max-h-[360px] overflow-y-auto rounded-lg border border-border bg-bg", children: targets.length === 0 ? (_jsx("div", { className: "px-3 py-6 text-center text-[13px] text-text-tertiary", children: "No user messages are available to fork." })) : (targets.map((target) => (_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => onSelect(target), className: cn('block w-full border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0', 'hover:bg-bg-hover focus:bg-bg-hover focus:outline-none'), children: [_jsx("span", { className: "block text-[12px] font-medium text-text-secondary", children: String(target.entryId) }), _jsx("span", { className: "mt-1 line-clamp-3 block text-[12px] leading-5 text-text-tertiary", children: previewText(target.text) })] }, String(target.entryId))))) }), _jsx("div", { className: "mt-4 flex justify-end", children: _jsx(Button, { variant: "unstyled", type: "button", onClick: onClose, className: "h-8 rounded-md border border-border px-3 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover", children: "Cancel" }) })] }) }));
}
