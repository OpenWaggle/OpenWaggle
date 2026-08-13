import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { match } from '@diegogbrisa/ts-match';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey';
import { Button } from '@/shared/ui/Button';
import { ModalDialog } from '@/shared/ui/ModalDialog';
import { CommitDialogBody, CommitDialogFooter } from './CommitDialogContent';
function humanCommitError(result) {
    if (result.ok)
        return '';
    return match(result.code)
        .with('empty-message', () => 'Commit message is required.')
        .with('nothing-to-commit', () => 'No changes are available to commit.')
        .with('merge-in-progress', () => 'A merge is in progress. Resolve it before committing.')
        .with('not-git-repo', () => 'Selected folder is not a Git repository.')
        .otherwise(() => result.message);
}
export function CommitDialog({ projectPath, status, statusError, isRefreshing, isCommitting, onRefresh, onCommit, onClose, }) {
    const [message, setMessage] = useState('');
    const [amend, setAmend] = useState(false);
    const [error, setError] = useState(null);
    const [selectedPaths, setSelectedPaths] = useState(() => new Set((status?.changedFiles ?? []).map((file) => file.path)));
    const changedFiles = status?.changedFiles ?? [];
    useEscapeHotkey(onClose);
    function togglePath(filePath) {
        setSelectedPaths((prev) => {
            const next = new Set(prev);
            if (next.has(filePath)) {
                next.delete(filePath);
            }
            else {
                next.add(filePath);
            }
            return next;
        });
    }
    function toggleAll() {
        setSelectedPaths(selectedPaths.size === changedFiles.length
            ? new Set()
            : new Set(changedFiles.map((file) => file.path)));
    }
    async function handleCommit() {
        if (!projectPath || !message.trim() || selectedPaths.size === 0)
            return;
        setError(null);
        await match
            .promise(onCommit(message.trim(), amend, [...selectedPaths]))
            .with({ ok: true }, () => onClose())
            .with({ ok: false }, (result) => setError(humanCommitError(result)))
            .exhaustive();
    }
    const canSubmit = !!projectPath && !!message.trim() && selectedPaths.size > 0 && !isCommitting;
    return (_jsx(ModalDialog, { label: "Commit changes", onClose: onClose, children: _jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border px-4 py-3", children: [_jsx("h2", { className: "text-sm font-semibold text-text-primary", children: "Commit changes" }), _jsx(Button, { variant: "unstyled", type: "button", onClick: onClose, className: "rounded p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary", title: "Close", children: _jsx(X, { className: "size-4" }) })] }), _jsx(CommitDialogBody, { status: status, statusError: statusError, error: error, isRefreshing: isRefreshing, form: { message, amend, selectedPaths }, actions: {
                        onRefresh,
                        onMessageChange: setMessage,
                        onAmendChange: setAmend,
                        onTogglePath: togglePath,
                        onToggleAll: toggleAll,
                    } }), _jsx(CommitDialogFooter, { canSubmit: canSubmit, isCommitting: isCommitting, onClose: onClose, onCommit: () => void handleCommit() })] }) }));
}
