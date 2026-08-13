import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Edit3 } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { buildSidebarBranchRows } from '../lib/sidebar-branches';
import { SessionListItem } from './SessionListItem';
import { SidebarBranchRows } from './SidebarBranchRows';
import { SidebarProjectHeader } from './SidebarProjectHeader';
function DraftSessionRow({ projectLabel, onSelect, }) {
    return (_jsxs(Button, { variant: "unstyled", type: "button", "aria-current": "true", "aria-label": `Draft session in ${projectLabel}`, onClick: onSelect, className: "group flex h-[34px] w-full items-center gap-2 bg-bg-active pl-10 pr-4 text-left transition-colors hover:bg-bg-hover", children: [_jsx(Edit3, { className: "size-3.5 shrink-0 text-text-secondary" }), _jsx("span", { className: "min-w-0 flex-1 truncate text-[12px] font-medium text-text-primary", children: "New session" }), _jsx("span", { className: "shrink-0 rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted", children: "Draft" })] }));
}
function sessionBranchDisclosure(session, state) {
    const sourceBranches = state.activeSessionTree?.session.id === session.id
        ? state.activeSessionTree.branches
        : (session.branches ?? []);
    const visibleBranchCount = sourceBranches.filter((branch) => branch.archived !== true).length;
    const hasDraftBranch = state.draftBranch?.sessionId === session.id;
    const branchesCollapsed = session.treeUiState?.branchesSidebarCollapsed === true;
    return {
        hasDisclosure: visibleBranchCount > 1 && !hasDraftBranch,
        rowsCollapsed: branchesCollapsed && !hasDraftBranch,
    };
}
function ProjectSessionRows({ group, projectLabel, state, sessionActions, branchActions, onNewSession, }) {
    const showDraftSession = state.draftSessionProjectPath === group.projectPath;
    if (group.sessions.length === 0 && !showDraftSession) {
        return _jsx("div", { className: "px-10 py-1.5 text-[12px] text-text-muted", children: "No sessions" });
    }
    return (_jsxs("div", { className: "space-y-0.5", children: [showDraftSession ? (_jsx(DraftSessionRow, { projectLabel: projectLabel, onSelect: () => onNewSession(group.projectPath) })) : null, group.sessions.map((session) => (_jsx(ProjectSessionRow, { session: session, state: state, sessionActions: sessionActions, branchActions: branchActions }, String(session.id))))] }));
}
function ProjectSessionRow({ session, state, sessionActions, branchActions, }) {
    const disclosure = sessionBranchDisclosure(session, state);
    const branchRows = buildSidebarBranchRows({
        session,
        activeSessionTree: state.activeSessionTree,
        activeBranchId: session.id === state.activeSessionId ? state.activeBranchId : session.lastActiveBranchId,
        branchesCollapsed: disclosure.rowsCollapsed,
        draftBranch: state.draftBranch,
    });
    return (_jsxs("div", { children: [_jsx(SessionListItem, { session: session, isActive: session.id === state.activeSessionId, variant: "project", actions: sessionActions, branchDisclosure: {
                    visible: disclosure.hasDisclosure,
                    collapsed: disclosure.rowsCollapsed,
                    onToggle: () => branchActions.toggle(session.id, !disclosure.rowsCollapsed),
                } }), _jsx(SidebarBranchRows, { sessionId: String(session.id), rows: branchRows, actions: branchActions })] }));
}
export function SidebarProjectGroupSection({ group, renderState, displayProjectName, projectActions, sessionActions, branchActions, }) {
    const projectLabel = displayProjectName(group.projectPath);
    const collapsed = renderState.collapsedProjectPaths.has(group.projectPath);
    return (_jsxs("section", { className: "mb-2", children: [_jsx(SidebarProjectHeader, { group: group, projectLabel: projectLabel, isCurrentProject: group.projectPath === renderState.projectPath, collapsed: collapsed, actions: projectActions }), collapsed ? null : (_jsx(ProjectSessionRows, { group: group, projectLabel: projectLabel, state: renderState, sessionActions: sessionActions, branchActions: branchActions, onNewSession: projectActions.newSession }))] }));
}
