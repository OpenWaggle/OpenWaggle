import { getMessageText as getAgentMessageText } from '@shared/types/agent';
import { SessionNodeId } from '@shared/types/brand';
function getUiMessageText(message) {
    return message.parts.flatMap((part) => (part.type === 'text' ? [part.content] : [])).join('\n');
}
function isSummarizableAbandonedNode(node) {
    return (node.kind === 'user_message' ||
        node.kind === 'assistant_message' ||
        node.kind === 'branch_summary' ||
        node.kind === 'compaction_summary' ||
        node.kind === 'custom');
}
function pathToRootIds(nodesById, nodeId) {
    const pathIds = new Set();
    let currentId = nodeId;
    while (currentId) {
        const currentKey = String(currentId);
        if (pathIds.has(currentKey)) {
            break;
        }
        pathIds.add(currentKey);
        currentId = nodesById.get(currentKey)?.parentId ?? null;
    }
    return pathIds;
}
function findTranscriptNode(workspace, messageId) {
    return workspace?.transcriptPath.find((entry) => String(entry.node.id) === messageId)?.node;
}
export function createBranchDraftSelectionFromNode(node) {
    if (node.kind === 'user_message' && node.parentId) {
        const text = node.message ? getAgentMessageText(node.message).trim() : '';
        return {
            sourceNodeId: node.parentId,
            routeNodeId: node.parentId,
            ...(text ? { prefillText: text } : {}),
        };
    }
    return {
        sourceNodeId: node.id,
        routeNodeId: node.id,
    };
}
export function createBranchDraftSelection({ messages, workspace, messageId, }) {
    const message = messages.find((candidate) => candidate.id === messageId);
    const node = findTranscriptNode(workspace, messageId);
    if (message?.role === 'user' && node?.parentId) {
        const text = getUiMessageText(message).trim();
        return {
            sourceNodeId: node.parentId,
            routeNodeId: node.parentId,
            ...(text ? { prefillText: text } : {}),
        };
    }
    if (node) {
        return createBranchDraftSelectionFromNode(node);
    }
    const nodeId = SessionNodeId(messageId);
    return {
        sourceNodeId: nodeId,
        routeNodeId: nodeId,
    };
}
export function shouldPromptForBranchSummary(workspace, targetNodeId) {
    if (!workspace?.activeNodeId || workspace.activeNodeId === targetNodeId) {
        return false;
    }
    const nodesById = new Map(workspace.tree.nodes.map((node) => [String(node.id), node]));
    const targetPathIds = pathToRootIds(nodesById, targetNodeId);
    let currentId = workspace.activeNodeId;
    const visited = new Set();
    while (currentId) {
        const currentKey = String(currentId);
        if (targetPathIds.has(currentKey) || visited.has(currentKey)) {
            return false;
        }
        visited.add(currentKey);
        const currentNode = nodesById.get(currentKey);
        if (!currentNode) {
            return false;
        }
        if (isSummarizableAbandonedNode(currentNode)) {
            return true;
        }
        currentId = currentNode.parentId;
    }
    return false;
}
