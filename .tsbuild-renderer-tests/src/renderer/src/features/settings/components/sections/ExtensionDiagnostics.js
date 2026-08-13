import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { match } from '@diegogbrisa/ts-match';
import { cn } from '@/shared/lib/cn';
const MAX_VISIBLE_DIAGNOSTICS = 3;
function diagnosticTone(diagnostic) {
    return match(diagnostic.severity)
        .with('error', () => 'text-error')
        .with('warning', () => 'text-amber-300')
        .exhaustive();
}
export function ExtensionDiagnostics({ diagnostics, }) {
    if (diagnostics.length === 0) {
        return null;
    }
    return (_jsxs("div", { className: "mt-3 space-y-1 rounded-md border border-error/20 bg-error/5 p-2", children: [diagnostics.slice(0, MAX_VISIBLE_DIAGNOSTICS).map((diagnostic) => (_jsxs("div", { className: "text-[11px]", children: [_jsx("span", { className: cn('font-medium', diagnosticTone(diagnostic)), children: diagnostic.code }), _jsxs("span", { className: "text-text-tertiary", children: [": ", diagnostic.message] })] }, `${diagnostic.code}:${diagnostic.message}`))), diagnostics.length > MAX_VISIBLE_DIAGNOSTICS ? (_jsxs("div", { className: "text-[11px] text-text-muted", children: [diagnostics.length - MAX_VISIBLE_DIAGNOSTICS, " more diagnostics"] })) : null] }));
}
