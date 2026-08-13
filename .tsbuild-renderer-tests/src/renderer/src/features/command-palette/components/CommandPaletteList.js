import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { buildCommandPaletteEntries } from '../lib/command-palette-entries';
import { CommandPaletteItemButton } from './CommandPaletteItemButton';
export function CommandPaletteList({ items, highlightIndex, onHighlightIndexChange, listRef, }) {
    const entries = buildCommandPaletteEntries(items);
    return (_jsxs("div", { ref: listRef, className: "max-h-[400px] overflow-y-auto", children: [items.length === 0 ? _jsx(CommandPaletteEmptyState, {}) : null, entries.map((entry) => {
                if (entry.type === 'section')
                    return _jsx(CommandPaletteSectionHeader, { label: entry.label }, entry.key);
                if (entry.type === 'separator')
                    return _jsx("div", { className: "border-t border-border" }, entry.key);
                return (_jsx(CommandPaletteItemButton, { item: entry.item, highlighted: entry.index === highlightIndex, index: entry.index, onHighlightIndexChange: onHighlightIndexChange }, entry.key));
            })] }));
}
function CommandPaletteEmptyState() {
    return (_jsx("div", { className: "flex h-16 items-center justify-center text-[13px] text-text-muted", children: "No matching commands" }));
}
function CommandPaletteSectionHeader({ label }) {
    return (_jsx("div", { className: "flex h-7 items-center border-t border-border px-3.5", children: _jsx("span", { className: "text-[11px] font-medium text-text-muted", children: label }) }));
}
