import type { SessionSummary } from '@shared/types/session'

const EMPTY_UPDATED_AT = 0

export type SidebarSessionSortMode = 'recent' | 'oldest' | 'name'

export interface SidebarProjectGroup {
  readonly projectPath: string
  readonly sessions: readonly SessionSummary[]
  readonly latestUpdatedAt: number
}

export interface SidebarProjectGroups {
  readonly projects: readonly SidebarProjectGroup[]
}

interface BuildSidebarProjectGroupsInput {
  readonly sessions: readonly SessionSummary[]
  readonly currentProjectPath: string | null
  readonly recentProjects: readonly string[]
  readonly sortMode: SidebarSessionSortMode
}

function normalizedProjectPath(path: string | null): string | null {
  const trimmed = path?.trim()
  return trimmed ? trimmed : null
}

function sortSessions(
  sessions: readonly SessionSummary[],
  sortMode: SidebarSessionSortMode,
): readonly SessionSummary[] {
  const next = [...sessions]
  next.sort((left, right) => {
    if (sortMode === 'oldest') {
      return left.updatedAt - right.updatedAt
    }
    if (sortMode === 'name') {
      return left.title.localeCompare(right.title)
    }
    return right.updatedAt - left.updatedAt
  })
  return next
}

function latestUpdatedAt(sessions: readonly SessionSummary[]): number {
  return sessions.reduce((latest, session) => Math.max(latest, session.updatedAt), EMPTY_UPDATED_AT)
}

function addUniqueProjectPath(paths: string[], path: string | null): void {
  const normalized = normalizedProjectPath(path)
  if (!normalized || paths.includes(normalized)) {
    return
  }
  paths.push(normalized)
}

export function buildSidebarProjectGroups({
  sessions,
  currentProjectPath,
  recentProjects,
  sortMode,
}: BuildSidebarProjectGroupsInput): SidebarProjectGroups {
  const sessionsByProject = new Map<string, SessionSummary[]>()

  for (const session of sessions) {
    const projectPath = normalizedProjectPath(session.projectPath)
    if (!projectPath) {
      continue
    }

    const projectSessions = sessionsByProject.get(projectPath) ?? []
    projectSessions.push(session)
    sessionsByProject.set(projectPath, projectSessions)
  }

  const projectPaths: string[] = []
  addUniqueProjectPath(projectPaths, currentProjectPath)
  for (const projectPath of recentProjects) {
    addUniqueProjectPath(projectPaths, projectPath)
  }

  const sessionProjectPaths = [...sessionsByProject.keys()].sort((left, right) => {
    const leftUpdatedAt = latestUpdatedAt(sessionsByProject.get(left) ?? [])
    const rightUpdatedAt = latestUpdatedAt(sessionsByProject.get(right) ?? [])
    return rightUpdatedAt - leftUpdatedAt
  })
  for (const projectPath of sessionProjectPaths) {
    addUniqueProjectPath(projectPaths, projectPath)
  }

  return {
    projects: projectPaths.map((projectPath) => {
      const projectSessions = sessionsByProject.get(projectPath) ?? []
      return {
        projectPath,
        sessions: sortSessions(projectSessions, sortMode),
        latestUpdatedAt: latestUpdatedAt(projectSessions),
      }
    }),
  }
}
