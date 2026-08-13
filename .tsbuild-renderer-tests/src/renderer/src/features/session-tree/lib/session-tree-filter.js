import { match } from '@diegogbrisa/ts-match';
import { getMessageText } from '@shared/types/agent';
const BOOKKEEPING_NODE_KINDS = new Set([
    'label',
    'custom',
    'model_change',
    'thinking_level_change',
    'session_info',
]);
function isBookkeepingNode(node) {
    return BOOKKEEPING_NODE_KINDS.has(node.kind);
}
function isToolNode(node) {
    return node.kind === 'tool_result';
}
function isUserNode(node) {
    return node.kind === 'user_message' || node.role === 'user';
}
function isLabeledNode(node) {
    return node.kind === 'label';
}
function nodeKey(node) {
    return String(node.id);
}
function parentKey(node) {
    return node.parentId ? String(node.parentId) : null;
}
function normalizeSearchText(text) {
    return text.trim().replace(/\s+/g, ' ').toLowerCase();
}
function searchTextForNode(node) {
    const parts = [
        String(node.id),
        node.kind.replace(/_/g, ' '),
        node.role ?? '',
        node.branchId ? String(node.branchId) : '',
        node.contentJson,
        node.metadataJson,
    ];
    if (node.message) {
        parts.push(getMessageText(node.message));
    }
    return normalizeSearchText(parts.join(' '));
}
function addVisibleAncestors(input) {
    let currentParentId = parentKey(input.node);
    while (currentParentId) {
        const parent = input.nodeById.get(currentParentId);
        if (!parent) {
            return;
        }
        if (input.visibleNodeIdSet.has(currentParentId)) {
            input.includedNodeIdSet.add(currentParentId);
        }
        currentParentId = parentKey(parent);
    }
}
export function filterSessionTreeNodes(nodes, mode) {
    return match(mode)
        .with('all', () => nodes)
        .with('user-only', () => nodes.filter(isUserNode))
        .with('labeled-only', () => nodes.filter(isLabeledNode))
        .with('no-tools', () => nodes.filter((node) => !isBookkeepingNode(node) && !isToolNode(node)))
        .with('default', () => nodes.filter((node) => !isBookkeepingNode(node)))
        .exhaustive();
}
export function searchSessionTreeNodes(input) {
    const normalizedQuery = normalizeSearchText(input.query);
    if (!normalizedQuery) {
        return input.filteredNodes;
    }
    const nodeById = new Map(input.nodes.map((node) => [nodeKey(node), node]));
    const visibleNodeIdSet = new Set(input.filteredNodes.map(nodeKey));
    const includedNodeIdSet = new Set();
    for (const node of input.filteredNodes) {
        if (!searchTextForNode(node).includes(normalizedQuery)) {
            continue;
        }
        includedNodeIdSet.add(nodeKey(node));
        addVisibleAncestors({ node, nodeById, visibleNodeIdSet, includedNodeIdSet });
    }
    return input.filteredNodes.filter((node) => includedNodeIdSet.has(nodeKey(node)));
}
