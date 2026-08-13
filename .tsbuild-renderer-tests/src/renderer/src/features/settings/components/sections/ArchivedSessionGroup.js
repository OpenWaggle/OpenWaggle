import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { projectName } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { ArchivedSessionRow } from './ArchivedSessionRow';
export function ArchivedSessionGroup({ group, onRestore, onDelete }) {
    const [collapsed, setCollapsed] = useState(false);
    const Chevron = collapsed ? ChevronRight : ChevronDown;
    return (_jsxs("div", { children: [_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => setCollapsed((p) => !p), className: "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-bg-hover", children: [_jsx(Chevron, { className: "size-3 shrink-0 text-text-muted" }), _jsx("span", { className: "text-[13px] font-medium text-text-secondary", children: group.path ? projectName(group.path) : 'No project' }), _jsxs("span", { className: "text-[11px] text-text-muted", children: ["(", group.sessions.length, ")"] })] }), _jsx("div", { className: "grid transition-[grid-template-rows] duration-200 ease-out", style: { gridTemplateRows: collapsed ? '0fr' : '1fr' }, children: _jsx("div", { className: "min-h-0 overflow-hidden", children: _jsx("div", { className: "space-y-1 pt-1 pl-2", children: group.sessions.map((session) => (_jsx(ArchivedSessionRow, { session: session, onRestore: onRestore, onDelete: onDelete }, String(session.id)))) }) }) })] }));
}
