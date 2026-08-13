import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { X } from 'lucide-react';
import { useTerminalSession } from '@/features/terminal/hooks/useTerminalSession';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@/shared/ui/Button';
function getTerminalLabel(status) {
    if (status.errorMessage)
        return 'unavailable';
    return status.isReady ? '/bin/zsh' : 'connecting...';
}
export function TerminalPanel({ projectPath, onClose }) {
    const { containerRef, terminalStatus } = useTerminalSession(projectPath);
    return (_jsxs("div", { className: "flex shrink-0 flex-col border-t border-border bg-bg h-full", children: [_jsxs("div", { className: "flex h-8 items-center justify-between border-b border-border px-3", children: [_jsxs("span", { className: "text-[13px] text-text-secondary", children: ["Terminal ", getTerminalLabel(terminalStatus)] }), _jsx(Button, { variant: "unstyled", type: "button", onClick: onClose, className: "flex items-center justify-center rounded p-0.5 text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors", title: "Close terminal", children: _jsx(X, { className: "size-3.5" }) })] }), _jsx("div", { ref: containerRef, className: "flex-1 overflow-hidden p-1" }), terminalStatus.errorMessage && (_jsx("div", { className: "border-t border-border px-3 py-2 text-[12px] text-error", children: terminalStatus.errorMessage }))] }));
}
