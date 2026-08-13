import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Check } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { ProviderModelIcon, resolveIconColor } from './provider-icon';
export function ModelSelectorRow({ model, isSelected, onSelect }) {
    const iconColor = resolveIconColor(model.provider);
    function handleSelect() {
        onSelect(model);
    }
    return (_jsxs("div", { role: "option", tabIndex: -1, "aria-selected": isSelected, "aria-label": model.name, onClick: handleSelect, onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleSelect();
            }
        }, title: model.id, className: cn('group flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors', 'cursor-pointer text-[#e7e9ee] hover:bg-[#171b21]', isSelected && 'bg-[#1a1f28]'), children: [_jsx(ProviderModelIcon, { provider: model.provider, className: "size-4 shrink-0 flex-none", style: { color: iconColor } }), _jsxs("div", { className: "min-w-0 flex-1 truncate text-[13px] font-medium", children: [model.name, _jsx("span", { className: "ml-1.5 text-[11px] font-normal text-text-tertiary", children: model.providerName })] }), model.contextWindowLabel && (_jsx("span", { className: "shrink-0 text-[10px] text-text-tertiary", children: model.contextWindowLabel })), isSelected && _jsx(Check, { className: "size-3 shrink-0 text-accent" })] }));
}
