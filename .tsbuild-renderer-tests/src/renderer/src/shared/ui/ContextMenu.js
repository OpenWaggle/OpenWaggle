import { jsx as _jsx } from "react/jsx-runtime";
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useClickOutside } from '@/shared/hooks/useClickOutside';
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey';
import { cn } from '@/shared/lib/cn';
export function ContextMenu({ open, onClose, position, children }) {
    const menuRef = useRef(null);
    useClickOutside(menuRef, onClose, open);
    useEscapeHotkey(onClose, { enabled: open });
    if (!open)
        return null;
    return createPortal(_jsx("div", { ref: menuRef, className: cn('fixed z-50 min-w-[160px] py-1 rounded-lg border border-border-light bg-bg-secondary shadow-lg'), style: { left: position.x, top: position.y }, children: children }), document.body);
}
