import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MessageSquareMore, PackageOpen } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { Popover } from '@/shared/ui/Popover';
export function ComposerExtensionActions({ launchers }) {
    const [open, setOpen] = useState(false);
    if (launchers.length === 0) {
        return null;
    }
    function handleOpen(launcher) {
        setOpen(false);
        launcher.onOpen();
    }
    return (_jsx("div", { className: "mb-2 flex justify-end", children: _jsxs(Popover, { className: "w-[300px] overflow-hidden py-1", onOpenChange: setOpen, open: open, placement: "top-end", trigger: _jsxs(Button, { "aria-expanded": open, className: cn('h-7 rounded-full border px-2.5 text-[11px]', open
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border bg-bg-secondary/80 text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'), onClick: () => setOpen(!open), title: "Open extension actions", type: "button", variant: "unstyled", children: [_jsx(MessageSquareMore, { className: "size-3.5" }), _jsx("span", { children: "Extensions" }), _jsx("span", { className: "rounded-full bg-bg-tertiary px-1.5 text-[10px] text-text-muted", children: launchers.length })] }), children: [_jsxs("div", { className: "border-b border-border px-3 py-2", children: [_jsx("div", { className: "text-[11px] font-semibold text-text-primary", children: "Composer extension launchers" }), _jsx("div", { className: "mt-0.5 text-[10px] text-text-muted", children: "Compact actions only. Extensions cannot inject composer input controls." })] }), _jsx("div", { className: "max-h-[260px] overflow-y-auto py-1", children: launchers.map((launcher) => (_jsxs(Button, { align: "start", className: "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-2 rounded-none px-3 py-2 text-left", onClick: () => handleOpen(launcher), type: "button", variant: "unstyled", children: [_jsx(PackageOpen, { className: "mt-0.5 size-3.5 text-accent" }), _jsxs("span", { className: "min-w-0", children: [_jsx("span", { className: "block truncate text-[12px] font-medium text-text-primary", children: launcher.title }), _jsx("span", { className: "mt-0.5 block truncate text-[11px] text-text-tertiary", children: launcher.description })] }), _jsx("span", { className: "rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-muted", children: launcher.badge })] }, launcher.id))) })] }) }));
}
