import type { SessionId } from '@shared/types/brand'

interface ActiveRunState {
  readonly activeRunIds: Set<SessionId>
}

export function addActiveRunToState(state: ActiveRunState, id: SessionId) {
  if (state.activeRunIds.has(id)) return state
  return { activeRunIds: new Set([...state.activeRunIds, id]) }
}

export function removeActiveRunFromState(state: ActiveRunState, id: SessionId) {
  if (!state.activeRunIds.has(id)) return state
  const activeRunIds = new Set(state.activeRunIds)
  activeRunIds.delete(id)
  return { activeRunIds }
}
