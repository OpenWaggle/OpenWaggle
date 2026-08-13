import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, Archive, Edit3, GitBranch, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { Popover } from '@/shared/ui/Popover';
import { TextInput } from '@/shared/ui/TextInput';
function DraftBranchRow({ sourceNodeId }) {
    return (_jsxs("div", { className: "mx-2 flex h-7 w-[calc(100%-16px)] items-center gap-2 rounded-md border border-dashed border-border pl-11 pr-3 text-left text-text-tertiary", children: [_jsx(GitBranch, { className: "size-3 shrink-0" }), _jsxs("span", { className: "min-w-0 flex-1 truncate text-[12px]", children: ["Draft branch from ", sourceNodeId] })] }));
}
function BranchRenameInput({ branch, cancelRename, inputElement, renameValue, saveRename, setRenameValue, }) {
    return (_jsx(TextInput, { ref: inputElement, value: renameValue, onChange: (event) => setRenameValue(event.target.value), onBlur: () => saveRename(branch), onKeyDown: (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                saveRename(branch);
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                cancelRename();
            }
        }, variant: "transparent", inputSize: "sm", className: "min-w-0 flex-1 px-0 text-[12px]" }));
}
function BranchActionsPopover({ branch, isOpen, menu, rename, onArchive, }) {
    return (_jsxs(Popover, { open: isOpen, onOpenChange: (open) => menu.setBranchId(open ? String(branch.id) : null), placement: "bottom-end", className: "min-w-[132px] py-1", trigger: ({ isOpen: triggerOpen, toggle }) => (_jsx(Button, { variant: "unstyled", type: "button", "aria-label": `Open branch actions for ${branch.name}`, "aria-expanded": triggerOpen, onClick: (event) => {
                event.stopPropagation();
                toggle();
            }, className: "flex size-5 shrink-0 items-center justify-center rounded text-text-tertiary opacity-0 transition-colors hover:bg-bg-hover hover:text-text-secondary group-hover:opacity-100 focus:opacity-100", children: _jsx(MoreHorizontal, { className: "size-3.5" }) })), children: [!branch.isMain ? (_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => rename.start(branch), className: "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover", children: [_jsx(Edit3, { className: "size-3 shrink-0" }), _jsx("span", { children: "Rename" })] })) : null, _jsxs(Button, { variant: "unstyled", type: "button", onClick: onArchive, className: "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover", children: [_jsx(Archive, { className: "size-3 shrink-0" }), _jsx("span", { children: branch.isMain ? 'Archive session' : 'Archive' })] })] }));
}
function SidebarBranchItem({ sessionId, row, menu, rename, actions, }) {
    const branchId = String(row.branch.id);
    const isRenaming = rename.branchId === branchId;
    return (_jsxs("div", { className: cn('group mx-2 flex h-7 w-[calc(100%-16px)] items-center gap-2 rounded-md pl-11 pr-1.5 text-left transition-colors', row.isActive
            ? 'bg-bg-active text-text-primary'
            : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'), children: [row.branch.interruptedRun ? (_jsx(AlertTriangle, { className: "size-3 shrink-0 text-amber-400", "aria-label": "Interrupted run" })) : (_jsx(GitBranch, { className: "size-3 shrink-0" })), isRenaming ? (_jsx(BranchRenameInput, { branch: row.branch, cancelRename: rename.cancel, inputElement: rename.inputElement, renameValue: rename.value, saveRename: rename.save, setRenameValue: rename.setValue })) : (_jsx(Button, { variant: "unstyled", type: "button", onClick: () => actions.select(sessionId, row.branch), className: "min-w-0 flex-1 truncate text-left text-[12px]", children: row.branch.name })), !isRenaming ? (_jsx(BranchActionsPopover, { branch: row.branch, isOpen: menu.branchId === branchId, menu: menu, rename: rename, onArchive: () => {
                    menu.setBranchId(null);
                    actions.archive(sessionId, row.branch);
                } })) : null] }));
}
export function SidebarBranchRows({ sessionId, rows, actions }) {
    const [renamingBranchId, setRenamingBranchId] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [menuBranchId, setMenuBranchId] = useState(null);
    const renameInputRef = useRef(null);
    useEffect(() => {
        if (!renamingBranchId)
            return;
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
    }, [renamingBranchId]);
    function cancelRename() {
        setRenamingBranchId(null);
        setRenameValue('');
    }
    const rename = {
        branchId: renamingBranchId,
        inputElement: renameInputRef,
        value: renameValue,
        cancel: cancelRename,
        save(branch) {
            const trimmed = renameValue.trim();
            if (trimmed && trimmed !== branch.name) {
                actions.rename(sessionId, branch, trimmed);
            }
            cancelRename();
        },
        setValue: setRenameValue,
        start(branch) {
            setMenuBranchId(null);
            setRenamingBranchId(String(branch.id));
            setRenameValue(branch.name);
        },
    };
    if (rows.length === 0)
        return null;
    return (_jsx("div", { className: "mb-1 space-y-0.5", children: rows.map((row) => row.type === 'draft' ? (_jsx(DraftBranchRow, { sourceNodeId: String(row.sourceNodeId) }, "draft")) : (_jsx(SidebarBranchItem, { sessionId: sessionId, row: row, menu: { branchId: menuBranchId, setBranchId: setMenuBranchId }, rename: rename, actions: actions }, String(row.branch.id)))) }));
}
