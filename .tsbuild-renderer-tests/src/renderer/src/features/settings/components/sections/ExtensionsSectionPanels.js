import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RefreshCw } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
export function ExtensionsSectionHeading({ projectCount, loading, onRefresh, }) {
    const scopeSummary = projectCount > 0
        ? `Showing global scope plus ${projectCount} project scope${projectCount === 1 ? '' : 's'}.`
        : 'No projects found; showing global scope only.';
    return (_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { className: "space-y-1", children: [_jsx("h2", { className: "text-[20px] font-semibold text-text-primary", children: "Extensions" }), _jsx("p", { className: "max-w-[760px] text-[13px] leading-5 text-text-tertiary", children: "Manage discovered OpenWaggle extension packages across global and project scopes." }), _jsx("p", { className: "text-[11px] text-text-muted", children: scopeSummary })] }), _jsx(Button, { disabled: loading, onClick: onRefresh, leftIcon: _jsx(RefreshCw, { className: "size-3" }), children: "Refresh" })] }));
}
export function ExtensionsErrorAlert({ message }) {
    if (!message) {
        return null;
    }
    return (_jsx("p", { role: "alert", className: "rounded-lg border border-error/25 bg-error/6 px-3 py-2 text-sm text-error", children: message }));
}
