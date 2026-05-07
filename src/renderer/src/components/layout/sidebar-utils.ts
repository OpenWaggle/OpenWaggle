import type { SessionSummary } from '@shared/types/session'
import { projectName } from '@/lib/format'

export interface ProjectGroup {
  path: string | null
  displayName: string
  sessions: SessionSummary[]
}

export function groupSessionsByProject(
  sessions: SessionSummary[],
  displayNameOverrides: Record<string, string> = {},
): ProjectGroup[] {
  const groups = new Map<string, SessionSummary[]>()

  for (const session of sessions) {
    const key = session.projectPath ?? '__none__'
    const existing = groups.get(key)
    if (existing) {
      existing.push(session)
    } else {
      groups.set(key, [session])
    }
  }

  const result: ProjectGroup[] = []
  for (const [key, convs] of groups) {
    const path = key === '__none__' ? null : key
    const displayName =
      key === '__none__' ? 'No project' : (displayNameOverrides[key] ?? projectName(key))
    result.push({ path, displayName, sessions: convs })
  }

  return result
}
