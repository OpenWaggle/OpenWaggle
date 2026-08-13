import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ModelSelectorList } from './ModelSelectorList';
const DROPDOWN_WIDTH = 220;
const DROPDOWN_MAX_HEIGHT = 320;
const VERTICAL_GAP = 4;
export function ModelSelectorDropdown({ dropdownRef, models, selectedModel, onKeyDown, onSelectModel, }) {
    return (_jsx("div", { ref: dropdownRef, role: "listbox", tabIndex: 0, onKeyDown: onKeyDown, className: "absolute z-[9999] flex flex-col overflow-hidden rounded-xl border border-[#1e2229] bg-[#0d0f12] p-1.5 shadow-2xl", style: {
            bottom: `calc(100% + ${VERTICAL_GAP}px)`,
            left: 0,
            width: DROPDOWN_WIDTH,
            maxHeight: DROPDOWN_MAX_HEIGHT,
        }, children: models.length === 0 ? (_jsxs("div", { className: "px-3 py-4 text-center", children: [_jsx("p", { className: "text-[12px] text-text-tertiary", children: "No models configured." }), _jsx("p", { className: "mt-1 text-[11px] text-text-muted", children: "Go to Settings \u2192 Connections to enable models." })] })) : (_jsx("div", { className: "overflow-y-auto", children: _jsx(ModelSelectorList, { models: models, selectedModel: selectedModel, onSelectModel: onSelectModel }) })) }));
}
