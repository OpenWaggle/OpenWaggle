import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Archive, Copy, Eye, Trash2 } from 'lucide-react';
import { api } from '@/shared/lib/ipc';
import { Button } from '@/shared/ui/Button';
import { ContextMenu } from '@/shared/ui/ContextMenu';
function SessionMenuButton({ icon: Icon, label, danger = false, onClick, }) {
    return (_jsxs(Button, { variant: "unstyled", type: "button", onClick: onClick, className: `flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover${danger ? ' hover:text-error' : ''}`, children: [_jsx(Icon, { className: "size-3 shrink-0" }), _jsx("span", { children: label })] }));
}
export function SessionItemContextMenu({ open, position, sessionId, onClose, onMarkUnread, onClone, onArchive, onDelete, }) {
    function closeAfter(action) {
        action();
        onClose();
    }
    function confirmDelete() {
        onClose();
        void api.showConfirm('Delete this session?', 'This cannot be undone.').then((confirmed) => {
            if (confirmed)
                onDelete(sessionId);
        });
    }
    return (_jsxs(ContextMenu, { open: open, onClose: onClose, position: position, children: [_jsx(SessionMenuButton, { icon: Eye, label: "Mark as unread", onClick: () => closeAfter(() => onMarkUnread(sessionId)) }), _jsx(SessionMenuButton, { icon: Copy, label: "Clone to new session", onClick: () => closeAfter(() => onClone(sessionId)) }), _jsx(SessionMenuButton, { icon: Archive, label: "Archive session", onClick: () => closeAfter(() => onArchive(sessionId)) }), _jsx(SessionMenuButton, { icon: Trash2, label: "Delete session", danger: true, onClick: confirmDelete })] }));
}
