import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { X } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
export function ComposerAlerts({ alerts }) {
    if (alerts.length === 0)
        return null;
    return (_jsx("div", { className: "mb-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-[12px] text-text-secondary", children: alerts.map((alert) => (_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsx("div", { children: alert.message }), alert.onDismiss ? (_jsx(Button, { variant: "unstyled", type: "button", onClick: alert.onDismiss, className: "mt-px shrink-0 rounded-sm p-0.5 text-text-tertiary transition-colors hover:text-text-primary", "aria-label": `Dismiss message: ${alert.message}`, title: "Dismiss message", children: _jsx(X, { className: "size-3.5" }) })) : null] }, alert.id))) }));
}
