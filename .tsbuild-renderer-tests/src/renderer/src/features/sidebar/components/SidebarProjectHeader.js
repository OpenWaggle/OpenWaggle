import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, Archive, ChevronDown, ChevronRight, Edit3, Folder, MoreHorizontal, } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { Popover } from '@/shared/ui/Popover';
import { TextInput } from '@/shared/ui/TextInput';
function ProjectMenuButton({ danger = false, disabled = false, icon: Icon, label, onClick, }) {
    return (_jsxs(Button, { variant: "unstyled", type: "button", disabled: disabled, onClick: onClick, className: cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent', danger ? 'text-error' : 'text-text-secondary'), children: [_jsx(Icon, { className: "size-3 shrink-0" }), _jsx("span", { children: label })] }));
}
function ProjectActionsMenu({ group, projectLabel, menuOpen, setMenuOpen, actions, }) {
    const sessionCount = group.sessions.length;
    const archiveLabel = sessionCount === 0
        ? 'No sessions to archive'
        : `Archive ${sessionCount} session${sessionCount === 1 ? '' : 's'}...`;
    function closeAfter(action) {
        setMenuOpen(false);
        action();
    }
    return (_jsxs(Popover, { open: menuOpen, onOpenChange: setMenuOpen, placement: "bottom-end", className: "min-w-[190px] py-1", trigger: ({ isOpen, toggle }) => (_jsx(Button, { variant: "unstyled", type: "button", "aria-label": `Open project actions for ${projectLabel}`, "aria-expanded": isOpen, onClick: (event) => {
                event.stopPropagation();
                toggle();
            }, className: "flex size-5 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary", children: _jsx(MoreHorizontal, { className: "size-3.5" }) })), children: [_jsx(ProjectMenuButton, { icon: Folder, label: "Open in Finder", onClick: () => closeAfter(() => actions.openInFinder(group.projectPath)) }), _jsx(ProjectMenuButton, { icon: Edit3, label: "Rename project", onClick: () => closeAfter(() => actions.rename(group.projectPath, projectLabel)) }), _jsx(ProjectMenuButton, { disabled: sessionCount === 0, icon: Archive, label: archiveLabel, onClick: () => closeAfter(() => actions.archiveSessions(group.projectPath, group.sessions)) }), _jsx(ProjectMenuButton, { danger: true, icon: AlertTriangle, label: "Remove...", onClick: () => closeAfter(() => actions.remove(group.projectPath)) })] }));
}
function ProjectRenameInput({ value, inputRef, onChange, onSave, onCancel, }) {
    return (_jsx(TextInput, { ref: inputRef, value: value, onChange: (event) => onChange(event.target.value), onBlur: onSave, onKeyDown: (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                onSave();
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
            }
        }, variant: "transparent", inputSize: "sm", className: "min-w-0 flex-1 px-0 font-medium" }));
}
function ProjectTitleArea({ actions, state, }) {
    if (state.renaming) {
        return (_jsxs("div", { className: "flex min-w-0 flex-1 items-center gap-1.5", children: [_jsx(state.DisclosureIcon, { className: "size-3 shrink-0 text-text-muted" }), _jsx(Folder, { className: "size-3.5 shrink-0" }), _jsx(ProjectRenameInput, { value: state.renameValue, inputRef: state.renameInputRef, onChange: actions.setRenameValue, onSave: actions.saveRename, onCancel: actions.cancelRename })] }));
    }
    return (_jsxs(Button, { variant: "unstyled", type: "button", "aria-label": `${state.collapsed ? 'Expand' : 'Collapse'} ${state.projectLabel}`, "aria-expanded": !state.collapsed, onClick: actions.toggle, className: "flex min-w-0 flex-1 items-center gap-1.5 text-left", children: [_jsx(state.DisclosureIcon, { className: "size-3 shrink-0 text-text-muted" }), _jsx(Folder, { className: "size-3.5 shrink-0" }), _jsx("span", { className: "min-w-0 flex-1 truncate text-[13px] font-medium", children: state.projectLabel })] }));
}
export function SidebarProjectHeader({ group, projectLabel, isCurrentProject, collapsed, actions, }) {
    const DisclosureIcon = collapsed ? ChevronRight : ChevronDown;
    const [menuOpen, setMenuOpen] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const renameInputRef = useRef(null);
    useEffect(() => {
        if (!renaming)
            return;
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
    }, [renaming]);
    function saveRename() {
        const trimmed = renameValue.trim();
        if (trimmed && trimmed !== projectLabel)
            actions.rename(group.projectPath, trimmed);
        setRenaming(false);
        setRenameValue('');
    }
    return (_jsxs("div", { className: cn('group flex h-7 w-full items-center gap-1.5 px-4 transition-colors hover:bg-bg-hover', isCurrentProject ? 'text-text-secondary' : 'text-text-tertiary'), title: group.projectPath, children: [_jsx(ProjectTitleArea, { state: {
                    collapsed,
                    DisclosureIcon,
                    projectLabel,
                    renaming,
                    renameInputRef,
                    renameValue,
                }, actions: {
                    cancelRename() {
                        setRenaming(false);
                        setRenameValue('');
                    },
                    saveRename,
                    setRenameValue,
                    toggle() {
                        actions.toggleCollapsed(group.projectPath);
                    },
                } }), _jsxs("div", { className: "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100", children: [_jsx(Button, { variant: "unstyled", type: "button", "aria-label": `New session in ${projectLabel}`, onClick: () => actions.newSession(group.projectPath), className: "flex size-5 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary", children: _jsx(Edit3, { className: "size-3.5" }) }), _jsx(ProjectActionsMenu, { group: group, projectLabel: projectLabel, menuOpen: menuOpen, setMenuOpen: setMenuOpen, actions: {
                            ...actions,
                            rename(_path, name) {
                                setMenuOpen(false);
                                setRenameValue(name);
                                setRenaming(true);
                            },
                        } })] })] }));
}
