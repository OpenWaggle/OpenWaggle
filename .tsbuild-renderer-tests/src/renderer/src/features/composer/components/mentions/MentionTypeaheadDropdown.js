import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FileText, Folder } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
const ICON_SIZE = 14;
const MAX_VISIBLE_ITEMS = 8;
const ITEM_HEIGHT_PX = 32;
export function MentionTypeaheadDropdown({ items, highlightIndex, position, onSelect, onClose, }) {
    const containerRef = useRef(null);
    useEffect(() => {
        const highlighted = containerRef.current?.children[highlightIndex];
        if (highlighted instanceof HTMLElement) {
            highlighted.scrollIntoView({ block: 'nearest' });
        }
    }, [highlightIndex]);
    useEffect(() => {
        function handleClickOutside(event) {
            const target = event.target;
            if (containerRef.current &&
                target instanceof Node &&
                !containerRef.current.contains(target)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);
    if (items.length === 0)
        return null;
    const maxHeight = MAX_VISIBLE_ITEMS * ITEM_HEIGHT_PX;
    return createPortal(_jsx("div", { ref: containerRef, className: cn('fixed z-50 min-w-[280px] max-w-[400px] rounded-lg border border-border-light bg-bg-secondary', 'shadow-lg overflow-y-auto py-1'), style: {
            bottom: window.innerHeight - position.top,
            left: position.left,
            maxHeight,
        }, children: items.map((item, index) => {
            const dirPart = item.path.includes('/')
                ? item.path.slice(0, item.path.lastIndexOf('/') + 1)
                : '';
            return (_jsxs(Button, { variant: "unstyled", type: "button", className: cn('flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-left', index === highlightIndex ? 'bg-bg-hover' : 'hover:bg-bg-hover'), onMouseDown: (e) => {
                    e.preventDefault();
                    onSelect(item);
                }, children: [item.isDirectory ? (_jsx(Folder, { size: ICON_SIZE, className: "shrink-0 text-text-tertiary" })) : (_jsx(FileText, { size: ICON_SIZE, className: "shrink-0 text-text-tertiary" })), _jsxs("span", { className: "truncate", children: [dirPart && _jsx("span", { className: "text-text-muted", children: dirPart }), _jsx("span", { className: "text-text-primary font-medium", children: item.basename })] })] }, item.path));
        }) }), document.body);
}
