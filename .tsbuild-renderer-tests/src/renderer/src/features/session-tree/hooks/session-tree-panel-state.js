export const INITIAL_SESSION_TREE_PANEL_STATE = {
    expandedNodeIdsOverride: null,
    focusIndex: 0,
};
export function sessionTreePanelReducer(state, action) {
    if (action.type === 'set-expanded-node-ids-override') {
        return { ...state, expandedNodeIdsOverride: action.value };
    }
    return { ...state, focusIndex: action.value };
}
