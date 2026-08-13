import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Archive } from 'lucide-react';
export function ArchivedEmptyState() {
    return (_jsxs("div", { className: "flex flex-col items-center gap-3 py-20 text-center", children: [_jsx(Archive, { className: "size-6 text-text-muted/60" }), _jsx("p", { className: "text-[13px] text-text-muted", children: "No archived sessions or branches" })] }));
}
