function normalizeProjectPath(projectPath) {
    const trimmed = projectPath?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : 'no-project';
}
export function buildComposerDraftContextKey(input) {
    const projectKey = `project:${normalizeProjectPath(input.projectPath)}`;
    if (!input.sessionId) {
        return `${projectKey}:new-session`;
    }
    const sessionKey = `${projectKey}:session:${String(input.sessionId)}`;
    if (input.draftSourceNodeId) {
        return `${sessionKey}:draft:${String(input.draftSourceNodeId)}`;
    }
    if (input.activeBranchId) {
        return `${sessionKey}:branch:${String(input.activeBranchId)}`;
    }
    if (input.activeNodeId) {
        return `${sessionKey}:node:${String(input.activeNodeId)}`;
    }
    return `${sessionKey}:main`;
}
