import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { Checkbox } from '@/shared/ui/Checkbox';
export function ModelCheckboxRow({ model, checked, provider, onToggle }) {
    return (_jsx(Checkbox, { checked: checked, onChange: () => onToggle(provider, model.id, !checked), className: "accent-accent", label: _jsxs(_Fragment, { children: [_jsx("span", { className: "min-w-0 flex-1 truncate text-[13px] text-text-primary", children: model.name }), !model.available && _jsx("span", { className: "text-[11px] text-text-muted", children: "Auth required" })] }), labelClassName: "h-8 gap-2.5 rounded-lg px-2 hover:bg-bg-hover" }));
}
