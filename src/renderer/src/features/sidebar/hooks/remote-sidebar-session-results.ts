import type { SessionSummary } from '@shared/types/session'
import { projectName } from '@/shared/lib/format'
import type { SidebarRowState } from '../lib/sidebar-row-state'

export function appendUniqueSidebarSessions(
  current: readonly SessionSummary[],
  incoming: readonly SessionSummary[],
) {
  const byId = new Map(current.map((session) => [String(session.id), session]))
  for (const session of incoming) byId.set(String(session.id), session)
  return [...byId.values()]
}

export function sidebarSessionMatchesText(
  session: SessionSummary,
  query: string,
  projectDisplayNames: Readonly<Record<string, string>>,
) {
  if (query === '') return true
  const projectPath = session.projectPath ?? ''
  const nativeName = projectPath === '' ? '' : projectName(projectPath)
  const customName = projectDisplayNames[projectPath] ?? ''
  return [session.title, nativeName, customName].some((value) =>
    value.toLowerCase().includes(query),
  )
}

export function mergeVisibleSidebarSessions(input: {
  readonly loadedSessions: readonly SessionSummary[]
  readonly remoteSessions: readonly SessionSummary[]
  readonly filterState: SidebarRowState | null
  readonly stateBySessionId: ReadonlyMap<string, SidebarRowState>
  readonly normalizedQuery: string
  readonly projectDisplayNames: Readonly<Record<string, string>>
}) {
  const loadedMatches = input.loadedSessions.filter((session) => {
    if (
      input.filterState !== null &&
      input.stateBySessionId.get(String(session.id)) !== input.filterState
    ) {
      return false
    }
    return sidebarSessionMatchesText(session, input.normalizedQuery, input.projectDisplayNames)
  })
  return appendUniqueSidebarSessions(loadedMatches, input.remoteSessions)
}
