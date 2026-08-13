import { filterSessionTreeNodes, searchSessionTreeNodes } from '../lib/session-tree-filter';
import { clampSessionTreeFocusIndex, getVisibleSessionTreeRows, resolveExpandedSessionTreeNodeIds, resolveSessionTreeRowExpandedNodeIds, } from '../lib/session-tree-visibility';
const EMPTY_SESSION_NODES = [];
function treeNodes(tree) {
    return tree?.nodes ?? EMPTY_SESSION_NODES;
}
function expandedNodeIdsOverrideForTree(input) {
    if (!input.tree) {
        return null;
    }
    if (input.expandedNodeIdsOverride?.sessionId !== input.tree.session.id) {
        return null;
    }
    return input.expandedNodeIdsOverride.nodeIds;
}
function filterNodes(tree, filterMode) {
    if (!tree) {
        return EMPTY_SESSION_NODES;
    }
    return filterSessionTreeNodes(tree.nodes, filterMode);
}
function searchNodes(input) {
    if (!input.tree) {
        return EMPTY_SESSION_NODES;
    }
    return searchSessionTreeNodes({
        nodes: input.tree.nodes,
        filteredNodes: input.filteredNodes,
        query: input.query,
    });
}
export function buildSessionTreePanelRows(input) {
    const activePathIds = new Set(input.transcriptPath.map((entry) => String(entry.node.id)));
    const nodes = treeNodes(input.tree);
    const expandedNodeIds = resolveExpandedSessionTreeNodeIds({
        nodes,
        uiState: input.tree?.uiState ?? null,
        overrideNodeIds: expandedNodeIdsOverrideForTree(input),
    });
    const modeFilteredNodes = filterNodes(input.tree, input.filterMode);
    const filteredNodes = searchNodes({
        tree: input.tree,
        filteredNodes: modeFilteredNodes,
        query: input.searchQuery,
    });
    const searchActive = input.searchQuery.trim().length > 0;
    const rowExpandedNodeIds = resolveSessionTreeRowExpandedNodeIds({
        filteredNodes,
        expandedNodeIds,
        searchActive,
    });
    const visibleRows = getVisibleSessionTreeRows({
        nodes,
        filteredNodes,
        expandedNodeIds: rowExpandedNodeIds,
        activePathIds,
    });
    return {
        activePathIds,
        clampedFocusIndex: clampSessionTreeFocusIndex(input.focusIndex, visibleRows.length),
        expandedNodeIds,
        rowExpandedNodeIds,
        searchActive,
        visibleNodes: visibleRows.map((row) => row.node),
        visibleRows,
    };
}
