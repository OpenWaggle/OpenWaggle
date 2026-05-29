import type { SessionSummary } from '@shared/types/session'

export interface ArchivedBranchProjectGroup {
  readonly path: string | null
  readonly sessions: readonly SessionSummary[]
}

export function groupArchivedBranchesByProject(sessions: readonly SessionSummary[]) {
  const groups = new Map<string, ArchivedBranchProjectGroup>()
  for (const session of sessions) {
    const key = session.projectPath ?? '__none__'
    const group = groups.get(key)
    if (group) {
      groups.set(key, { ...group, sessions: [...group.sessions, session] })
    } else {
      groups.set(key, { path: session.projectPath, sessions: [session] })
    }
  }
  return Array.from(groups.values())
}
