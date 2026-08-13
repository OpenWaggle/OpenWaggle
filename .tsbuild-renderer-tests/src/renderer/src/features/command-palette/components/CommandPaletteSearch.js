import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Search } from 'lucide-react';
import { TextInput } from '@/shared/ui/TextInput';
export function CommandPaletteSearch({ inputRef, query, onKeyDown, onQueryChange, }) {
    return (_jsxs("div", { className: "flex h-11 items-center gap-2 border-b border-border px-3.5", children: [_jsx(Search, { className: "size-3.5 shrink-0 text-text-tertiary" }), _jsx(TextInput, { ref: inputRef, type: "text", value: query, onKeyDown: onKeyDown, onChange: (event) => onQueryChange(event.target.value), placeholder: "Search", variant: "transparent", inputSize: "sm", className: "flex-1 px-0" })] }));
}
