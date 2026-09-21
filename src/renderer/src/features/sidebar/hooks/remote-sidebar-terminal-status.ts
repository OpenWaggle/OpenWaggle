import { SessionId } from '@shared/types/brand'
import type { SessionStatus } from '@shared/types/session-status'
import type { SidebarRowState } from '../lib/sidebar-row-state'

export type HydratedTerminalIds = {
  completed: Set<string>
  error: Set<string>
}

export function sidebarRemoteStatusIds(
  filterState: SidebarRowState | null,
  stateBySessionId: ReadonlyMap<string, SidebarRowState>,
  hydratedTerminalIds: HydratedTerminalIds,
) {
  if (filterState === null || filterState === 'interrupted') return []
  return [...stateBySessionId.entries()]
    .filter(
      ([id, state]) =>
        state === filterState &&
        (filterState !== 'completed' && filterState !== 'error'
          ? true
          : !hydratedTerminalIds[filterState].has(id)),
    )
    .map(([id]) => SessionId(id))
    .sort()
}

export function terminalStateRefreshKey(stateBySessionId: ReadonlyMap<string, SidebarRowState>) {
  return [...stateBySessionId.entries()]
    .filter(([, state]) => state === 'completed' || state === 'error')
    .map(([id, state]) => `${id}:${state}`)
    .sort()
    .join('\u0000')
}

export function pruneHydratedTerminalIds(
  hydratedTerminalIds: HydratedTerminalIds,
  rawStatuses: ReadonlyMap<SessionId, SessionStatus>,
) {
  for (const state of ['completed', 'error'] as const) {
    for (const id of hydratedTerminalIds[state]) {
      if (rawStatuses.get(SessionId(id)) !== state) hydratedTerminalIds[state].delete(id)
    }
  }
}
