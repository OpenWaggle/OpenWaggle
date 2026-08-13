import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Loader2 } from 'lucide-react';
import { TextInput } from '@/shared/ui/TextInput';
export function BranchPickerSearch({ query, isBranchActionRunning, onQueryChange, }) {
    return (_jsxs("div", { className: "mb-2 flex items-center gap-1.5", children: [_jsx(TextInput, { value: query, onChange: (event) => onQueryChange(event.target.value), placeholder: "Search branches", inputSize: "sm", className: "flex-1 border-border px-2 text-[12px]" }), isBranchActionRunning ? _jsx(Loader2, { className: "size-3.5 animate-spin text-accent" }) : null] }));
}
