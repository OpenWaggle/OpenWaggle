import { SessionId } from '@shared/types/brand'
import type { SessionStatus } from '@shared/types/session-status'
import type { SidebarRowState } from '../lib/sidebar-row-state'
import type { SidebarTerminalState } from './remote-sidebar-session-query'

export function isTerminalState(state: SidebarRowState | null): state is SidebarTerminalState {
  return state === 'completed' || state === 'error'
}

/**
 * The terminal rows Host pages have hydrated so far. It is React state, so every change makes a
 * new object: the React Compiler caches what is derived from it by identity.
 */
export interface HydratedTerminalIds {
  readonly completed: ReadonlySet<string>
  readonly error: ReadonlySet<string>
}

export function emptyHydratedTerminalIds(): HydratedTerminalIds {
  return { completed: new Set<string>(), error: new Set<string>() }
}

/** `current` with `ids` added under `state`, or `current` itself when it holds them all. */
export function withHydratedTerminalIds(
  current: HydratedTerminalIds,
  state: SidebarTerminalState,
  ids: readonly string[],
): HydratedTerminalIds {
  if (ids.every((id) => current[state].has(id))) return current
  return { ...current, [state]: new Set([...current[state], ...ids]) }
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

/** A raw status that only a Run started after the Host listed the row can give it. */
const STATUSES_AFTER_A_NEW_RUN: ReadonlySet<SessionStatus> = new Set([
  'working',
  'connecting',
  'waggle-running',
  'awaiting-input',
])

/**
 * Forgets Host-discovered terminal rows that no longer hold that state. A row keeps its id while
 * its raw status still holds it, so a visit and Mark as unread do not rewind paging, or while the
 * row shows it, because a parent reads Done below whatever its own last Run was (ADR 0065). Only
 * a row in `resolvedIds` (loaded, or listed by the Host) has a shown state resolved with its
 * lineage; any other was loaded after the states were resolved, so it is kept until it starts a
 * new Run. Returns `hydratedTerminalIds` itself when nothing is forgotten.
 */
export function pruneHydratedTerminalIds(
  hydratedTerminalIds: HydratedTerminalIds,
  rawStatuses: ReadonlyMap<SessionId, SessionStatus>,
  stateBySessionId: ReadonlyMap<string, SidebarRowState>,
  resolvedIds: ReadonlySet<string>,
): HydratedTerminalIds {
  const holds = (id: string, state: SidebarTerminalState) => {
    const raw = rawStatuses.get(SessionId(id))
    // Not yet resolved with its lineage, but a Run it started since then ends its state.
    if (!resolvedIds.has(id)) return raw === undefined || !STATUSES_AFTER_A_NEW_RUN.has(raw)
    const shown = stateBySessionId.get(id)
    return shown === undefined || shown === state || raw === state
  }
  const completed = [...hydratedTerminalIds.completed].filter((id) => holds(id, 'completed'))
  const error = [...hydratedTerminalIds.error].filter((id) => holds(id, 'error'))
  if (
    completed.length === hydratedTerminalIds.completed.size &&
    error.length === hydratedTerminalIds.error.size
  ) {
    return hydratedTerminalIds
  }
  return { completed: new Set(completed), error: new Set(error) }
}
