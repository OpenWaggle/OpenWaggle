import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Columns2, Rows3, WrapText } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
const TOGGLE_CLASS = 'flex size-6 items-center justify-center rounded-[5px] border transition-colors';
function toggleClassName(active) {
    return active
        ? `${TOGGLE_CLASS} border-accent bg-diff-stage-bg text-accent`
        : `${TOGGLE_CLASS} border-transparent text-text-tertiary hover:bg-bg-hover hover:text-text-primary`;
}
/**
 * View controls for the diff. These write through to the persisted setting rather
 * than to local state, so the panel and Settings > Appearance always agree.
 */
export function DiffViewToolbar({ viewOptions, onSetDiffView, onToggleWrapLines, }) {
    const isSplit = viewOptions.diffView === 'split';
    return (_jsxs("div", { className: "flex items-center gap-1", children: [_jsx(Button, { variant: "unstyled", type: "button", onClick: onToggleWrapLines, "aria-pressed": viewOptions.wrapLines, "aria-label": viewOptions.wrapLines ? 'Disable line wrapping' : 'Enable line wrapping', title: viewOptions.wrapLines ? 'Disable line wrapping' : 'Enable line wrapping', className: toggleClassName(viewOptions.wrapLines), children: _jsx(WrapText, { className: "size-3.5" }) }), _jsx(Button, { variant: "unstyled", type: "button", onClick: () => onSetDiffView(isSplit ? 'unified' : 'split'), "aria-pressed": isSplit, "aria-label": isSplit ? 'Switch to unified view' : 'Switch to split view', title: isSplit ? 'Switch to unified view' : 'Switch to split view', className: toggleClassName(isSplit), children: isSplit ? _jsx(Columns2, { className: "size-3.5" }) : _jsx(Rows3, { className: "size-3.5" }) })] }));
}
