import type { SessionTreePanelAction, SessionTreePanelState } from '../model'

export const INITIAL_SESSION_TREE_PANEL_STATE: SessionTreePanelState = {
  expandedNodeIdsOverride: null,
  focusIndex: 0,
}

export function sessionTreePanelReducer(
  state: SessionTreePanelState,
  action: SessionTreePanelAction,
): SessionTreePanelState {
  if (action.type === 'set-expanded-node-ids-override') {
    return { ...state, expandedNodeIdsOverride: action.value }
  }

  return { ...state, focusIndex: action.value }
}
