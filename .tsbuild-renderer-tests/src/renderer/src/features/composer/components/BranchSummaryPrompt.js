import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { GitBranch, Loader2 } from 'lucide-react';
import { useBranchSummaryStore } from '@/features/chat/state';
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
function modeCopy(mode) {
    if (mode === 'custom') {
        return 'Write custom summary instructions in the composer, then press Send.';
    }
    if (mode === 'summarizing') {
        return 'Summarizing the abandoned branch before creating this branch…';
    }
    return 'Keep context from the abandoned branch?';
}
function SummaryButton({ children, disabled, onClick, variant = 'secondary', }) {
    return (_jsx(Button, { variant: "unstyled", type: "button", disabled: disabled, onClick: onClick, className: cn('h-6 rounded-md px-2 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-60', variant === 'primary' && 'bg-accent text-bg hover:bg-accent-dim', variant === 'secondary' && 'border border-border text-text-secondary hover:bg-bg-hover', variant === 'ghost' && 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'), children: children }));
}
export function BranchSummaryPrompt({ onNoSummary, onSummarize, onCustomSummary, onCancel, }) {
    const prompt = useBranchSummaryStore((state) => state.prompt);
    const mode = prompt?.mode ?? null;
    const busy = mode === 'summarizing';
    useEscapeHotkey(onCancel, { enabled: mode !== null && !busy });
    if (!mode) {
        return null;
    }
    return (_jsxs("div", { className: "mb-2 rounded-[var(--radius-panel)] border border-accent/20 bg-accent/7 px-3 py-2 text-[12px] text-text-secondary", children: [_jsxs("div", { className: "flex min-w-0 items-center gap-2", children: [_jsx(GitBranch, { className: "size-3.5 shrink-0 text-accent" }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("div", { className: "font-medium text-text-primary", children: "Branch summary" }), _jsx("div", { className: "truncate text-text-tertiary", children: modeCopy(mode) })] }), busy ? _jsx(Loader2, { className: "size-3.5 animate-spin text-accent" }) : null] }), mode === 'choice' ? (_jsxs("div", { className: "mt-2 flex flex-wrap justify-end gap-1.5", children: [_jsx(SummaryButton, { onClick: onCancel, variant: "ghost", children: "Cancel" }), _jsx(SummaryButton, { onClick: onNoSummary, children: "No summary" }), _jsx(SummaryButton, { onClick: onCustomSummary, children: "Custom" }), _jsx(SummaryButton, { onClick: onSummarize, variant: "primary", children: "Summarize" })] })) : null, mode === 'custom' ? (_jsxs("div", { className: "mt-2 flex flex-wrap justify-end gap-1.5", children: [_jsx(SummaryButton, { onClick: onNoSummary, children: "No summary" }), _jsx(SummaryButton, { onClick: onCancel, variant: "ghost", children: "Cancel" })] })) : null] }));
}
