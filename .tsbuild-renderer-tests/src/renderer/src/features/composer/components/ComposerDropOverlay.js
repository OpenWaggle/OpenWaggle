import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowDownToLine, Ban } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
export function ComposerDropOverlay({ isAtCapacity }) {
    return (_jsx("div", { className: cn('pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius-panel)] backdrop-blur-[1px]', isAtCapacity ? 'bg-red-400/5' : 'bg-accent/8'), children: _jsx("div", { className: cn('flex items-center gap-2 rounded-lg bg-bg-secondary/90 px-4 py-2 shadow-sm border', isAtCapacity ? 'border-red-400/30' : 'border-accent/30'), children: isAtCapacity ? _jsx(ComposerDropCapacityMessage, {}) : _jsx(ComposerDropReadyMessage, {}) }) }));
}
function ComposerDropCapacityMessage() {
    return (_jsxs(_Fragment, { children: [_jsx(Ban, { className: "size-4 text-red-400" }), _jsx("span", { className: "text-[13px] font-medium text-red-400", children: "Maximum files attached" })] }));
}
function ComposerDropReadyMessage() {
    return (_jsxs(_Fragment, { children: [_jsx(ArrowDownToLine, { className: "size-4 text-accent" }), _jsx("span", { className: "text-[13px] font-medium text-accent", children: "Drop files to attach" })] }));
}
