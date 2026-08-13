import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { Textarea } from '@/shared/ui/Textarea';
const ROWS = 3;
const COMMIT_MESSAGE_ID = 'commit-message';
const STATUS_CLASS = {
    modified: 'text-text-secondary',
    added: 'text-success',
    deleted: 'text-error',
    renamed: 'text-accent',
    copied: 'text-accent',
    untracked: 'text-text-tertiary',
    unknown: 'text-text-tertiary',
};
export function CommitDialogBody({ status, statusError, error, isRefreshing, form, actions, }) {
    const changedFiles = status?.changedFiles ?? [];
    return (_jsxs("div", { className: "space-y-4 p-4", children: [_jsx(CommitStatusSummary, { status: status, selectedCount: form.selectedPaths.size, isRefreshing: isRefreshing, onRefresh: actions.onRefresh }), statusError && _jsx("p", { className: "text-[13px] text-error", children: statusError }), error && _jsx("p", { className: "text-[13px] text-error", children: error }), _jsx(CommitMessageFields, { form: form, actions: actions }), _jsx(ChangedFilesSelector, { changedFiles: changedFiles, selectedPaths: form.selectedPaths, onToggleAll: actions.onToggleAll, onTogglePath: actions.onTogglePath })] }));
}
function CommitStatusSummary({ status, selectedCount, isRefreshing, onRefresh, }) {
    return (_jsxs("div", { className: "flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2", children: [_jsx("div", { className: "text-[13px] text-text-secondary", children: status
                    ? `${selectedCount}/${status.filesChanged} files selected • +${status.additions} / -${status.deletions}`
                    : 'Git status unavailable' }), _jsxs(Button, { variant: "ghost", size: "xs", onClick: onRefresh, title: "Refresh status", disabled: isRefreshing, children: [_jsx(RefreshCw, { className: cn('size-3.5', isRefreshing && 'animate-spin') }), "Refresh"] })] }));
}
function CommitMessageFields({ form, actions, }) {
    return (_jsxs(_Fragment, { children: [_jsxs("label", { className: "block", htmlFor: COMMIT_MESSAGE_ID, children: [_jsx("span", { className: "mb-1.5 block text-[13px] font-medium text-text-secondary", children: "Commit message" }), _jsx(Textarea, { id: COMMIT_MESSAGE_ID, rows: ROWS, value: form.message, onChange: (e) => actions.onMessageChange(e.target.value), placeholder: "Describe your changes", resize: "none", className: "rounded-md border-border text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent/50" })] }), _jsx(Checkbox, { checked: form.amend, onChange: (e) => actions.onAmendChange(e.target.checked), label: "Amend last commit" })] }));
}
function ChangedFilesSelector({ changedFiles, selectedPaths, onToggleAll, onTogglePath, }) {
    return (_jsxs("div", { className: "max-h-[220px] overflow-y-auto rounded-md border border-border bg-bg", children: [changedFiles.length > 0 && (_jsxs("div", { className: "flex items-center gap-2 border-b border-border px-3 py-1.5", children: [_jsx(Checkbox, { checked: selectedPaths.size === changedFiles.length, onChange: onToggleAll }), _jsx("span", { className: "text-[12px] font-medium text-text-tertiary", children: selectedPaths.size === changedFiles.length ? 'Deselect all' : 'Select all' })] })), changedFiles.length === 0 ? (_jsx("div", { className: "px-3 py-2 text-[13px] text-text-tertiary", children: "No file changes detected." })) : (changedFiles.map((file) => (_jsx(Checkbox, { checked: selectedPaths.has(file.path), onChange: () => onTogglePath(file.path), label: _jsxs(_Fragment, { children: [_jsx("span", { className: cn('truncate text-[13px] flex-1', STATUS_CLASS[file.status]), children: file.path }), _jsxs("span", { className: "shrink-0 text-[12px] text-text-tertiary", children: [file.additions > 0 ? `+${file.additions}` : '', file.additions > 0 && file.deletions > 0 ? ' / ' : '', file.deletions > 0 ? `-${file.deletions}` : ''] })] }), labelClassName: "border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-bg-hover transition-colors" }, file.path))))] }));
}
export function CommitDialogFooter({ canSubmit, isCommitting, onClose, onCommit, }) {
    return (_jsxs("div", { className: "flex items-center justify-end gap-2 border-t border-border px-4 py-3", children: [_jsx(Button, { variant: "secondary", onClick: onClose, children: "Cancel" }), _jsxs(Button, { variant: canSubmit ? 'primary' : 'secondary', onClick: onCommit, disabled: !canSubmit, children: [isCommitting && _jsx(Loader2, { className: "size-3.5 animate-spin" }), "Commit"] })] }));
}
