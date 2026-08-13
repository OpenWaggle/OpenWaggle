import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ListTree, X } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
export function SessionTreePanelHeader({ onClose }) {
    return (_jsxs("div", { className: "flex h-12 shrink-0 items-center justify-between border-b border-border px-4", children: [_jsxs("div", { className: "flex min-w-0 items-center gap-2", children: [_jsx(ListTree, { className: "size-4 shrink-0 text-text-tertiary" }), _jsx("h2", { className: "truncate text-[13px] font-semibold text-text-primary", children: "Session Tree" })] }), _jsx(Button, { variant: "unstyled", type: "button", "aria-label": "Close Session Tree", onClick: onClose, className: "rounded p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary", children: _jsx(X, { className: "size-4" }) })] }));
}
