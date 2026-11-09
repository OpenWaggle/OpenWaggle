import { SessionId } from '@shared/types/brand'
import type { SessionStatus } from '@shared/types/session-status'
import type { SidebarRowState } from '../lib/sidebar-row-state'
import type { SidebarTerminalState } from './remote-sidebar-session-query'

export function isTerminalState(state: SidebarRowState | null): state is SidebarTerminalState {
  return state === 'completed' || state === 'error'
}

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

/**
 * Forgets Host-discovered terminal rows that no longer hold that state. A row keeps its id while
 * its raw status still holds it, so a visit and Mark as unread do not rewind paging, or while the
 * row shows it, because a parent reads Done below whatever its own last Run was (ADR 0063). A row
 * with no shown state yet was loaded after the states were resolved, so it is kept too.
 */
export function pruneHydratedTerminalIds(
  hydratedTerminalIds: HydratedTerminalIds,
  rawStatuses: ReadonlyMap<SessionId, SessionStatus>,
  stateBySessionId: ReadonlyMap<string, SidebarRowState>,
) {
  for (const state of ['completed', 'error'] as const) {
    for (const id of hydratedTerminalIds[state]) {
      const shown = stateBySessionId.get(id)
      if (shown === undefined || shown === state || rawStatuses.get(SessionId(id)) === state) {
        continue
      }
      hydratedTerminalIds[state].delete(id)
    }
  }
}
