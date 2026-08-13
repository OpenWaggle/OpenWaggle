import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Hash, ListTree, PanelLeft, SquareTerminal } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { projectName } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
export function HeaderLeft({ activeBranchName, projectPath, sidebarOpen, title, onToggleSidebar, }) {
    return (_jsxs("div", { className: "flex items-center gap-2", children: [!sidebarOpen && (_jsx(Button, { variant: "ghost", size: "icon-sm", "aria-label": "Show sidebar", "aria-expanded": sidebarOpen, onClick: onToggleSidebar, className: "no-drag", title: "Show sidebar", children: _jsx(PanelLeft, { className: "size-4" }) })), _jsx(Hash, { className: "no-drag size-3.5 text-text-tertiary" }), _jsx("span", { className: "no-drag text-[14px] font-medium text-text-primary", children: title }), _jsxs("span", { className: "no-drag text-[12px] text-text-tertiary", children: ["/ ", activeBranchName] }), _jsx("span", { className: "no-drag flex items-center h-5 px-2 rounded border border-border bg-bg-tertiary text-[12px] text-text-secondary", children: projectName(projectPath) }), _jsx("span", { className: "no-drag text-[16px] leading-none text-text-tertiary", children: "\u00B7\u00B7\u00B7" })] }));
}
function terminalTitle(projectPath, terminalOpen) {
    if (!projectPath) {
        return 'No project selected';
    }
    return terminalOpen ? 'Hide terminal' : 'Open terminal';
}
export function TerminalButton({ open, projectPath, onToggle }) {
    return (_jsxs(Button, { variant: "secondary", size: "none", radius: "sm", "aria-label": open ? 'Hide terminal' : 'Open terminal', "aria-expanded": open, onClick: onToggle, className: cn('no-drag h-7 border-button-border px-2.5', !projectPath && 'pointer-events-none opacity-30'), disabled: !projectPath, title: terminalTitle(projectPath, open), children: [_jsx(SquareTerminal, { className: "size-3.5 text-text-secondary" }), _jsx("span", { className: "text-[13px] font-medium text-text-primary", children: open ? 'Hide' : 'Open' }), _jsx("span", { className: "text-[9px] text-text-tertiary", children: "\u2228" })] }));
}
export function CommitButton({ isCommitting, projectPath, onOpen }) {
    const disabled = !projectPath || isCommitting;
    return (_jsxs(Button, { variant: "primary", size: "none", radius: "sm", "aria-label": "Open commit dialog", onClick: onOpen, className: cn('no-drag h-7 px-2.5', disabled && 'pointer-events-none opacity-40'), disabled: disabled, title: projectPath ? 'Open commit dialog' : 'No project selected', children: [_jsx("span", { className: "text-[13px] font-semibold text-bg", children: "Commit" }), _jsx("span", { className: "text-[9px] text-bg/50", children: "\u2228" })] }));
}
export function SessionTreeButton({ hasSessionTree, isChatRoute, open, onToggle, }) {
    const disabled = !hasSessionTree || !isChatRoute;
    return (_jsx(Button, { variant: open ? 'subtle' : 'secondary', size: "none", radius: "sm", "aria-label": "Toggle Session Tree", "aria-expanded": open, onClick: onToggle, disabled: disabled, className: cn('no-drag h-7 border-button-border px-2', disabled && 'pointer-events-none opacity-30'), title: hasSessionTree ? 'Toggle Session Tree' : 'No session tree available', children: _jsx(ListTree, { className: "size-3.5 text-text-secondary" }) }));
}
function diffStatusText(error, isLoading) {
    if (isLoading) {
        return 'Loading diff…';
    }
    return error ? 'Git unavailable' : 'Diff unavailable';
}
export function DiffToggleButton({ error, isChatRoute, isLoading, open, projectPath, status, onToggle, }) {
    const disabled = !projectPath || !isChatRoute;
    return (_jsx(Button, { variant: "ghost", size: "none", "aria-label": "Toggle diff panel", onClick: onToggle, disabled: disabled, className: cn('no-drag gap-1 hover:opacity-80', disabled && 'pointer-events-none opacity-30', open && 'opacity-100'), title: "Toggle diff panel", children: status ? (_jsxs(_Fragment, { children: [_jsxs("span", { className: "text-[13px] font-medium text-success", children: ["+", status.additions] }), _jsxs("span", { className: "text-[13px] font-medium text-error", children: ["-", status.deletions] })] })) : (_jsx("span", { className: "text-[13px] font-medium text-text-tertiary", children: diffStatusText(error, isLoading) })) }));
}
