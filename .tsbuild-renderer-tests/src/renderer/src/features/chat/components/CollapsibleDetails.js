import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
export function CollapsibleDetails({ showDetails, collapseLabel, onToggle, }) {
    return (_jsxs(Button, { variant: "unstyled", type: "button", className: "flex items-center gap-2 w-full py-1 text-text-muted hover:text-text-secondary transition-colors group", onClick: onToggle, children: [_jsx("span", { className: "h-px flex-1 bg-border group-hover:bg-border-light transition-colors" }), _jsxs("span", { className: "flex items-center gap-1 text-xs shrink-0 select-none", children: [showDetails ? 'Hide details' : collapseLabel, showDetails ? _jsx(ChevronUp, { className: "size-3" }) : _jsx(ChevronDown, { className: "size-3" })] }), _jsx("span", { className: "h-px flex-1 bg-border group-hover:bg-border-light transition-colors" })] }));
}
