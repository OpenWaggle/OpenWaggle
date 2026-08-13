import { messagePartToUIParts } from '@/features/chat/lib/useAgentChat.utils';
function workspaceBelongsToSession(workspace, sessionId) {
    return String(workspace.tree.session.id) === String(sessionId);
}
function workspacePathToMessages(workspace, messages) {
    const messagesById = new Map(messages.map((message) => [message.id, message]));
    const workspaceMessages = [];
    for (const entry of workspace.transcriptPath) {
        const message = entry.node.message;
        if (!message) {
            continue;
        }
        const messageId = String(message.id);
        const existingMessage = messagesById.get(messageId);
        if (existingMessage) {
            workspaceMessages.push(existingMessage);
            continue;
        }
        // Read once per message instead of re-walking message.metadata.* per branch.
        const branchSummary = message.metadata?.branchSummary;
        const compactionSummary = message.metadata?.compactionSummary;
        workspaceMessages.push({
            id: messageId,
            role: message.role,
            parts: message.parts.flatMap(messagePartToUIParts),
            createdAt: new Date(message.createdAt),
            ...(branchSummary || compactionSummary
                ? {
                    metadata: {
                        ...(branchSummary ? { branchSummary } : {}),
                        ...(compactionSummary ? { compactionSummary } : {}),
                    },
                }
                : {}),
        });
    }
    return workspaceMessages;
}
function isViewingActiveBranchHead(workspace) {
    const activeHeadNodeId = workspace.activeBranchId
        ? workspace.tree.branches.find((branch) => branch.id === workspace.activeBranchId)?.headNodeId
        : workspace.tree.session.lastActiveNodeId;
    return (workspace.activeNodeId !== null &&
        activeHeadNodeId !== undefined &&
        activeHeadNodeId !== null &&
        String(workspace.activeNodeId) === String(activeHeadNodeId));
}
function findLastWorkspaceMessageIndex(messages, workspaceMessages) {
    const workspaceMessageIds = new Set(workspaceMessages.map((message) => message.id));
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message && workspaceMessageIds.has(message.id)) {
            return index;
        }
    }
    return -1;
}
function isViewingDraftBranchSource(workspace, draftBranchSourceNodeId) {
    return (workspace.activeNodeId !== null &&
        draftBranchSourceNodeId !== undefined &&
        draftBranchSourceNodeId !== null &&
        String(workspace.activeNodeId) === String(draftBranchSourceNodeId));
}
function unsavedLiveTail(workspace, messages, lastWorkspaceMessageIndex) {
    const persistedMessageIds = new Set(workspace.tree.nodes.flatMap((node) => (node.message ? [String(node.message.id)] : [])));
    return messages
        .slice(lastWorkspaceMessageIndex + 1)
        .filter((message) => !persistedMessageIds.has(message.id));
}
function appendLiveTailWhenViewingHeadOrDraftSource(workspace, workspaceMessages, messages, draftBranchSourceNodeId) {
    const viewingHead = isViewingActiveBranchHead(workspace);
    const viewingDraftSource = isViewingDraftBranchSource(workspace, draftBranchSourceNodeId);
    if (!viewingHead && !viewingDraftSource) {
        return workspaceMessages;
    }
    const lastWorkspaceMessageIndex = findLastWorkspaceMessageIndex(messages, workspaceMessages);
    if (lastWorkspaceMessageIndex < 0 || lastWorkspaceMessageIndex === messages.length - 1) {
        return workspaceMessages;
    }
    const tail = unsavedLiveTail(workspace, messages, lastWorkspaceMessageIndex);
    return tail.length > 0 ? [...workspaceMessages, ...tail] : workspaceMessages;
}
export function resolveTranscriptMessages({ activeSessionId, activeWorkspace, messages, draftBranchSourceNodeId, }) {
    if (!activeSessionId || !activeWorkspace) {
        return messages;
    }
    if (!workspaceBelongsToSession(activeWorkspace, activeSessionId)) {
        return messages;
    }
    const workspaceMessages = workspacePathToMessages(activeWorkspace, messages);
    if (workspaceMessages.length === 0) {
        return messages;
    }
    return appendLiveTailWhenViewingHeadOrDraftSource(activeWorkspace, workspaceMessages, messages, draftBranchSourceNodeId);
}
