import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
export function StatusBadge({ status }) {
    if (status === 'found') {
        return (_jsxs("span", { className: "inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] text-success", children: [_jsx(CheckCircle2, { className: "size-3" }), "Found"] }));
    }
    if (status === 'error') {
        return (_jsxs("span", { className: "inline-flex items-center gap-1 rounded-full border border-error/30 bg-error/10 px-2 py-0.5 text-[10px] text-error", children: [_jsx(XCircle, { className: "size-3" }), "Error"] }));
    }
    return (_jsxs("span", { className: "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-text-tertiary", children: [_jsx(AlertCircle, { className: "size-3" }), "Missing"] }));
}
