import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { formatElapsed } from '@/features/chat/hooks/useStreamingPhase';
import { ExtensionAgentLoopSurface } from '@/features/extensions';
import { Spinner } from '@/shared/ui/Spinner';
import { RunSummary } from './RunSummary';
function CorePhaseIndicator({ label, elapsedMs, }) {
    return (_jsxs("div", { className: "flex items-center gap-2 py-3", children: [_jsx(Spinner, { size: "sm", className: "text-accent" }), _jsxs("span", { className: "text-sm text-text-tertiary", children: [label, "..."] }), elapsedMs > 0 ? (_jsx("span", { className: "text-sm text-text-muted tabular-nums", children: formatElapsed(elapsedMs) })) : null] }));
}
export function StatusRow({ row, extensions, }) {
    if (row.type === 'run-summary') {
        return (_jsx(ExtensionAgentLoopSurface, { fallback: _jsx(RunSummary, { phases: row.phases, totalMs: row.totalMs }), input: {
                surface: 'status',
                status: { label: 'Run complete', detail: formatElapsed(row.totalMs), tone: 'success' },
            }, projectPaths: extensions.projectPaths, registry: extensions.registry }));
    }
    return (_jsx(ExtensionAgentLoopSurface, { fallback: _jsx(CorePhaseIndicator, { elapsedMs: row.elapsedMs, label: row.label }), input: {
            surface: 'status',
            status: {
                label: `${row.label}...`,
                detail: row.elapsedMs > 0 ? formatElapsed(row.elapsedMs) : undefined,
                tone: 'running',
            },
        }, projectPaths: extensions.projectPaths, registry: extensions.registry }));
}
