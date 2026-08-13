import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { formatWorktreePathForDisplay } from '@shared/utils/worktree';
import { RefreshCw, X } from 'lucide-react';
import { DiffPanel } from '@/features/diff-panel/components';
import { Button } from '@/shared/ui/Button';
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary';
import { useUIStore } from '@/shell/ui-store';
export function ChatDiffPane({ section, onClose }) {
    // A working path that differs from the opened project is a Session worktree.
    const worktreeLabel = section.workingPath !== null && section.workingPath !== section.repositoryPath
        ? formatWorktreePathForDisplay(section.workingPath)
        : null;
    const diffRefreshKey = useUIStore((s) => s.diffRefreshKey);
    const bumpDiffRefreshKey = useUIStore((s) => s.bumpDiffRefreshKey);
    return (_jsxs("div", { className: "flex size-full min-w-0 flex-col overflow-hidden bg-diff-bg", children: [_jsxs("header", { className: "drag-region flex h-12 shrink-0 items-center justify-between border-b border-border bg-diff-header-bg px-3", children: [_jsxs("div", { className: "flex min-w-0 items-center gap-2", children: [_jsx("span", { className: "no-drag text-[13px] font-medium text-text-primary", children: "Changes" }), _jsx("span", { className: "no-drag truncate text-[11px] text-text-tertiary", children: worktreeLabel === null ? 'Opened checkout' : `Worktree · ${worktreeLabel}` })] }), _jsxs("div", { className: "no-drag flex items-center gap-1", children: [_jsx(Button, { variant: "unstyled", type: "button", "aria-label": "Refresh diff", onClick: bumpDiffRefreshKey, className: "rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary", title: "Refresh diff", children: _jsx(RefreshCw, { className: "size-3.5" }) }), _jsx(Button, { variant: "unstyled", type: "button", "aria-label": "Close diff sidebar", onClick: onClose, className: "rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary", title: "Close diff sidebar", children: _jsx(X, { className: "size-3.5" }) })] })] }), _jsx(PanelErrorBoundary, { name: "Diff", className: "min-h-0 flex-1 overflow-hidden", children: _jsx(DiffPanel, { workingPath: section.workingPath, sessionId: section.sessionId, onSendMessage: (content) => {
                        void section.onSendMessage(content);
                    } }, diffRefreshKey) })] }));
}
