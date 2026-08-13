import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Code } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
const ICON_SIZE = 12;
export function SymbolMentionChip({ symbolName }) {
    return (_jsxs("span", { className: cn('bg-success/10 text-success rounded px-1.5 py-0.5 text-[13px]', 'inline-flex items-center gap-1', 'select-none cursor-default'), children: [_jsx(Code, { size: ICON_SIZE, className: "shrink-0" }), _jsx("span", { className: "truncate max-w-[200px] font-mono", children: symbolName })] }));
}
