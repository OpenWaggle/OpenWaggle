import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { TIME_UNIT } from '@shared/constants/time';
import { Square } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { Spinner } from '@/shared/ui/Spinner';
function getCompactionLabel(reason) {
    if (reason === 'manual') {
        return 'Compacting context…';
    }
    if (reason === 'overflow') {
        return 'Context overflow detected, auto-compacting…';
    }
    return 'Auto-compacting…';
}
export function CompactionStatusStrip({ state, onCancel }) {
    const isRetrying = state.type === 'retrying';
    const retryDelaySeconds = isRetrying
        ? Math.ceil(state.delayMs / TIME_UNIT.MILLISECONDS_PER_SECOND)
        : 0;
    const label = isRetrying
        ? `Retrying (${String(state.attempt)}/${String(state.maxAttempts)}) in ${String(retryDelaySeconds)}s…`
        : getCompactionLabel(state.reason);
    const cancelLabel = isRetrying ? 'Cancel retry' : 'Cancel compaction';
    return (_jsxs("div", { className: "mx-auto flex w-[calc(100%-28px)] items-center gap-2 rounded-t-[var(--radius-panel)] border-x border-t border-border-light bg-bg-secondary p-[8px_10px_6px_10px] text-text-tertiary", children: [_jsx(Spinner, { size: "sm", className: isRetrying ? 'text-warning' : 'text-accent' }), _jsx("span", { className: "min-w-0 flex-1 text-[12px] font-medium", children: label }), _jsxs(Button, { variant: "unstyled", type: "button", onClick: onCancel, className: "flex h-6 items-center gap-1 rounded-md border border-error/30 bg-error/10 px-2 text-[11px] font-semibold text-error transition-colors hover:bg-error/18", "aria-label": cancelLabel, title: cancelLabel, children: [_jsx(Square, { className: "size-3" }), _jsx("span", { children: "Stop" })] })] }));
}
