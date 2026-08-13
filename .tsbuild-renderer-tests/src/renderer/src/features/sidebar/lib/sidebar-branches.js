function getSessionBranches(input) {
    if (input.activeSessionTree?.session.id === input.session.id) {
        return input.activeSessionTree.branches;
    }
    return input.session.branches ?? [];
}
function isDraftForSession(session, draftBranch) {
    return draftBranch !== null && draftBranch.sessionId === session.id;
}
export function buildSidebarBranchRows(input) {
    const hasDraftBranch = isDraftForSession(input.session, input.draftBranch);
    const visibleBranches = getSessionBranches(input).filter((branch) => branch.archived !== true);
    const hasMaterializedBranchRows = visibleBranches.length > 1;
    const collapsed = input.branchesCollapsed ?? input.session.treeUiState?.branchesSidebarCollapsed === true;
    if (!hasDraftBranch && (!hasMaterializedBranchRows || collapsed)) {
        return [];
    }
    const rows = [];
    if (hasDraftBranch) {
        rows.push({ type: 'draft', sourceNodeId: input.draftBranch.sourceNodeId });
    }
    for (const branch of visibleBranches) {
        rows.push({
            type: 'branch',
            branch,
            isActive: branch.id === input.activeBranchId,
        });
    }
    return rows;
}
