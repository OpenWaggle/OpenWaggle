import { useDeferredValue, useReducer, useRef, useState } from 'react';
import { useSessionStore } from '@/features/sessions/state';
import { usePreferencesStore } from '@/features/settings/state';
import { api } from '@/shared/lib/ipc';
import { useUIStore } from '@/shell/ui-store';
import { isSessionTreeFilterMode } from '../constants';
import { buildSessionTreePanelRows } from './session-tree-panel-rows';
import { INITIAL_SESSION_TREE_PANEL_STATE, sessionTreePanelReducer, } from './session-tree-panel-state';
import { useSessionTreeFilterMode } from './useSessionTreeFilterMode';
import { useSessionTreeFocusSync } from './useSessionTreeFocusSync';
import { useSessionTreeKeyboardControls } from './useSessionTreeKeyboardControls';
import { useSessionTreeNodeSelection } from './useSessionTreeNodeSelection';
import { useSessionTreeScrollControls } from './useSessionTreeScrollControls';
function isExpandedNode(node, expandedNodeIds) {
    return expandedNodeIds.some((expandedNodeId) => String(expandedNodeId) === String(node.id));
}
export function useSessionTreePanelController(onClose) {
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const [panelState, dispatchPanelState] = useReducer(sessionTreePanelReducer, INITIAL_SESSION_TREE_PANEL_STATE);
    const rowRefs = useRef(new Map());
    const treeRowsRef = useRef(null);
    const activeWorkspace = useSessionStore((state) => state.activeWorkspace);
    const draftBranch = useSessionStore((state) => state.draftBranch);
    const selectedModel = usePreferencesStore((state) => state.settings.selectedModel);
    const showToast = useUIStore((state) => state.showToast);
    const tree = activeWorkspace?.tree ?? null;
    const filter = useSessionTreeFilterMode(tree?.session.projectPath ?? null, showToast);
    const rows = buildSessionTreePanelRows({
        tree,
        transcriptPath: activeWorkspace?.transcriptPath ?? [],
        filterMode: filter.filterMode,
        searchQuery: deferredSearchQuery,
        focusIndex: panelState.focusIndex,
        expandedNodeIdsOverride: panelState.expandedNodeIdsOverride,
    });
    const scroll = useSessionTreeScrollControls();
    const selection = useSessionTreeNodeSelection({
        activeWorkspace,
        selectedModel,
        showToast,
        tree,
    });
    function persistExpandedNodeIds(sessionId, nextExpandedNodeIds) {
        void api
            .updateSessionTreeUiState(sessionId, { expandedNodeIds: nextExpandedNodeIds })
            .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            showToast(`Failed to save Session Tree state: ${message}`);
        });
    }
    function focusIndex(index) {
        dispatchPanelState({ type: 'set-focus-index', value: index });
    }
    function toggleNodeExpanded(row) {
        if (!tree || !row.hasExpandableChildren) {
            return;
        }
        const nextExpandedNodeIds = isExpandedNode(row.node, rows.expandedNodeIds)
            ? rows.expandedNodeIds.filter((expandedNodeId) => String(expandedNodeId) !== String(row.node.id))
            : [...rows.expandedNodeIds, row.node.id];
        dispatchPanelState({
            type: 'set-expanded-node-ids-override',
            value: { sessionId: tree.session.id, nodeIds: nextExpandedNodeIds },
        });
        persistExpandedNodeIds(tree.session.id, nextExpandedNodeIds);
    }
    const rowActions = {
        focusIndex,
        selectNode: selection.selectNode,
        toggleNodeExpanded,
    };
    useSessionTreeFocusSync({
        clampedFocusIndex: rows.clampedFocusIndex,
        rowRefs,
        treeRowsRef,
        visibleNodes: rows.visibleNodes,
    });
    useSessionTreeKeyboardControls({
        clampedFocusIndex: rows.clampedFocusIndex,
        focusIndex: panelState.focusIndex,
        rowExpandedNodeIds: rows.rowExpandedNodeIds,
        visibleRows: rows.visibleRows,
        onClose,
        onFocusIndex: focusIndex,
        onSelectNode: selection.selectNode,
        onToggleNodeExpanded: toggleNodeExpanded,
    });
    return {
        content: {
            rowActions,
            rowRefs,
            scrollContainerRef: scroll.scrollContainerRef,
            searchActive: rows.searchActive,
            showTreeScrollToBottom: scroll.showTreeScrollToBottom,
            tree,
            treeRowsRef,
            view: tree
                ? {
                    activeBranchId: activeWorkspace?.activeBranchId ?? null,
                    activePathIds: rows.activePathIds,
                    clampedFocusIndex: rows.clampedFocusIndex,
                    draftBranch,
                    rowExpandedNodeIds: rows.rowExpandedNodeIds,
                    tree,
                    visibleRows: rows.visibleRows,
                }
                : null,
            onScrollToTreeBottom: scroll.scrollToTreeBottom,
            onTreeScroll: scroll.syncTreeScrollButtonVisibility,
        },
        filters: {
            filterMode: filter.filterMode,
            searchQuery,
            onFilterModeChange: (mode) => {
                if (isSessionTreeFilterMode(mode)) {
                    filter.updateFilterMode(mode);
                }
            },
            onSearchQueryChange: setSearchQuery,
        },
        header: { onClose },
    };
}
