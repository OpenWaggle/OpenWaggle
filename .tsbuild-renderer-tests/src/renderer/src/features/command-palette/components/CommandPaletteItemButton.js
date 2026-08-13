import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
export function CommandPaletteItemButton({ item, highlighted, index, onHighlightIndexChange, }) {
    return (_jsxs(Button, { variant: "unstyled", type: "button", "data-highlighted": highlighted, onClick: item.action, onMouseEnter: () => onHighlightIndexChange(index), className: cn('flex h-10 w-full items-center gap-2.5 px-3.5 text-left transition-colors', highlighted
            ? 'bg-[#1e2229] text-text-primary'
            : 'text-text-secondary hover:bg-[#1e2229]/50'), children: [_jsx("span", { className: cn('shrink-0', highlighted ? 'text-text-primary' : 'text-text-muted'), children: item.icon }), _jsx("span", { className: "shrink-0 text-[13px] font-medium", children: item.label }), item.description ? (_jsx("span", { className: "truncate text-[12px] text-text-muted", children: item.description })) : null, _jsx(CommandPaletteTrailingContent, { item: item })] }));
}
function CommandPaletteTrailingContent({ item }) {
    if (!item.trailing && !item.trailingBadge)
        return null;
    return (_jsxs("span", { className: "ml-auto flex shrink-0 items-center gap-2", children: [item.trailingBadge ? (_jsx("span", { className: "rounded-full bg-[#1e2229] px-1.5 py-0.5 text-[10px] font-medium text-text-muted", children: item.trailingBadge })) : null, item.trailing ? _jsx("span", { className: "text-[11px] text-text-muted", children: item.trailing }) : null] }));
}
