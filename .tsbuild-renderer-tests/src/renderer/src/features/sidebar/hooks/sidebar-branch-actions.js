import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand';
import { useBranchSummaryStore, useChatStore } from '@/features/chat/state';
import { useComposerStore } from '@/features/composer/state';
import { api } from '@/shared/lib/ipc';
import { errorMessage } from './sidebar-action-utils';
function navigateToSessionBranch(deps, sessionId, branch) {
    const targetBranchId = String(branch.id);
    const headNodeId = branch.headNodeId ? String(branch.headNodeId) : null;
    void deps.navigate({
        to: '/sessions/$sessionId',
        params: { sessionId },
        search: (previous) => {
            const { node: _node, ...rest } = previous;
            return headNodeId
                ? { ...rest, branch: targetBranchId, node: headNodeId }
                : { ...rest, branch: targetBranchId };
        },
    });
    return { headNodeId, targetBranchId };
}
function refreshBranchWorkspace(deps, sessionId, branchId, nodeId) {
    void deps.refreshSessionWorkspace(sessionId, {
        branchId: SessionBranchId(branchId),
        nodeId,
    });
}
function switchSessionBranch(deps, sessionId, branch) {
    const targetSessionId = SessionId(sessionId);
    const { headNodeId, targetBranchId } = navigateToSessionBranch(deps, sessionId, branch);
    useBranchSummaryStore.getState().clearPrompt();
    if (deps.activeSessionId)
        deps.clearDraftBranchForSession(deps.activeSessionId);
    deps.clearDraftBranchForSession(targetSessionId);
    useChatStore.getState().setActiveSession(targetSessionId);
    if (!headNodeId)
        return;
    const targetNodeId = SessionNodeId(headNodeId);
    void api
        .navigateSessionTree(targetSessionId, deps.selectedModel, targetNodeId, { summarize: false })
        .catch((error) => {
        deps.showToast(`Failed to switch session branch: ${errorMessage(error)}`);
    })
        .finally(() => refreshBranchWorkspace(deps, targetSessionId, targetBranchId, targetNodeId));
}
function navigateToMainBranchAfterArchive(deps, sessionId) {
    const session = deps.sessions.find((item) => String(item.id) === sessionId);
    const mainBranch = session?.branches?.find((branch) => branch.isMain);
    if (mainBranch) {
        switchSessionBranch(deps, sessionId, mainBranch);
        return;
    }
    void deps.navigate({ to: '/sessions/$sessionId', params: { sessionId } });
}
export function createSidebarBranchActions(deps) {
    return {
        archive(sessionId, branch) {
            const targetSessionId = SessionId(sessionId);
            if (branch.isMain) {
                deps.archiveSession(targetSessionId);
                return;
            }
            void api
                .archiveSessionBranch(targetSessionId, branch.id)
                .then(() => useComposerStore.getState().clearScopedDraftsForBranch(sessionId, String(branch.id)))
                .then(() => deps.refreshAfterSessionMutation(targetSessionId))
                .then(() => {
                if (deps.activeBranchId === branch.id)
                    navigateToMainBranchAfterArchive(deps, sessionId);
            })
                .catch((error) => {
                deps.showToast(`Failed to archive branch: ${errorMessage(error)}`);
            });
        },
        rename(sessionId, branch, name) {
            const targetSessionId = SessionId(sessionId);
            void api
                .renameSessionBranch(targetSessionId, branch.id, name)
                .then(() => deps.refreshAfterSessionMutation(targetSessionId))
                .catch((error) => {
                deps.showToast(`Failed to rename branch: ${errorMessage(error)}`);
            });
        },
        select(sessionId, branch) {
            switchSessionBranch(deps, sessionId, branch);
        },
        toggle(sessionId, collapsed) {
            void api
                .updateSessionTreeUiState(sessionId, { branchesSidebarCollapsed: collapsed })
                .then(() => deps.refreshAfterSessionMutation(sessionId))
                .catch((error) => {
                deps.showToast(`Failed to update branch list: ${errorMessage(error)}`);
            });
        },
    };
}
