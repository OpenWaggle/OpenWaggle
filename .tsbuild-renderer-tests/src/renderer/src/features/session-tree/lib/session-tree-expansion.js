export function getDefaultExpandedSessionTreeNodeIds(nodes) {
    const parentIds = new Set(nodes.flatMap((node) => (node.parentId ? [String(node.parentId)] : [])));
    return nodes.flatMap((node) => (parentIds.has(String(node.id)) ? [node.id] : []));
}
export function resolveExpandedSessionTreeNodeIds(input) {
    if (input.overrideNodeIds) {
        return input.overrideNodeIds;
    }
    if (input.uiState?.expandedNodeIdsTouched) {
        return input.uiState.expandedNodeIds;
    }
    return getDefaultExpandedSessionTreeNodeIds(input.nodes);
}
export function resolveSessionTreeRowExpandedNodeIds(input) {
    if (input.searchActive) {
        return getDefaultExpandedSessionTreeNodeIds(input.filteredNodes);
    }
    return input.expandedNodeIds;
}
