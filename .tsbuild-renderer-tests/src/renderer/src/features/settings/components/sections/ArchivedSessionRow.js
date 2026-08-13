import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { RotateCcw, Trash2 } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { formatRelativeTime } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
export function ArchivedSessionRow({ session, onRestore, onDelete }) {
    return (_jsxs("div", { className: cn('group flex items-center gap-3 rounded-md border border-border px-3 py-2'), children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "truncate text-[13px] text-text-secondary", children: session.title }), _jsxs("p", { className: "text-[11px] text-text-muted", children: [session.messageCount, " messages \u00B7 ", formatRelativeTime(session.updatedAt)] })] }), _jsx(Button, { variant: "unstyled", type: "button", onClick: () => onRestore(session.id), className: "shrink-0 rounded-md px-2 py-1 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary", title: "Restore session", children: _jsx(RotateCcw, { className: "size-3.5" }) }), _jsx(Button, { variant: "unstyled", type: "button", onClick: () => onDelete(session.id), className: "shrink-0 rounded-md px-2 py-1 text-[12px] text-text-muted transition-colors hover:bg-bg-hover hover:text-error", title: "Delete permanently", children: _jsx(Trash2, { className: "size-3.5" }) })] }));
}
