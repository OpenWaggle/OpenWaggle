import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { TIME_UNIT } from '@shared/constants/time';
import { formatElapsed } from '@/features/chat/hooks/useStreamingPhase';
import { cn } from '@/shared/lib/cn';
function mergePhasesByLabel(phases) {
    const merged = new Map();
    const order = [];
    const seen = new Set();
    for (const p of phases) {
        merged.set(p.label, (merged.get(p.label) ?? 0) + p.durationMs);
        if (!seen.has(p.label)) {
            seen.add(p.label);
            order.push(p.label);
        }
    }
    return order.map((label) => ({ label, durationMs: merged.get(label) ?? 0 }));
}
export function RunSummary({ phases, totalMs }) {
    const visiblePhases = mergePhasesByLabel(phases).filter((p) => p.durationMs >= TIME_UNIT.MILLISECONDS_PER_SECOND);
    return (_jsxs("div", { className: "flex flex-col gap-1 py-3", children: [_jsxs("div", { className: "flex items-center gap-3 text-xs text-text-muted", children: [_jsx("div", { className: "h-px flex-1 bg-border" }), _jsxs("span", { children: ["Completed in ", formatElapsed(totalMs)] }), _jsx("div", { className: "h-px flex-1 bg-border" })] }), visiblePhases.length > 0 && (_jsx("div", { className: "flex flex-col gap-0.5 px-4 pt-1", children: visiblePhases.map((phase) => (_jsxs("div", { className: "flex items-center justify-between text-xs", children: [_jsx("span", { className: "text-text-tertiary", children: phase.label }), _jsx("span", { className: cn('text-text-muted tabular-nums'), children: formatElapsed(phase.durationMs) })] }, phase.label))) }))] }));
}
