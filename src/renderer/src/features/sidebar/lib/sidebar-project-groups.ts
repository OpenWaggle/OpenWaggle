import type { SessionSummary } from '@shared/types/session'

const EMPTY_UPDATED_AT = 0
const EMPTY_CREATED_AT = 0

export type SidebarSessionSortMode = 'recent' | 'oldest' | 'name'

export interface SidebarProjectGroup {
  readonly projectPath: string
  readonly sessions: readonly SessionSummary[]
  readonly firstSessionCreatedAt: number
  readonly latestUpdatedAt: number
  /**
   * How many of this project's sessions are Pinned and therefore rendered in the
   * Pinned section instead of here. Drives the group's empty-state hint when every
   * session it has is pinned away (issue #97).
   */
  readonly hoistedPinnedCount: number
  /**
   * Every session this project owns, whatever the sidebar is currently showing.
   *
   * `sessions` is what the tree renders: narrowed by the active filter and with pinned rows
   * hoisted into the Pinned section. A project-wide action must not act on that subset. Archiving
   * from the project menu offered to archive only the visible ones, and a project whose sessions
   * were all pinned reported nothing to archive at all.
   */
  readonly allSessions: readonly SessionSummary[]
}

export interface SidebarProjectGroups {
  readonly projects: readonly SidebarProjectGroup[]
}

interface BuildSidebarProjectGroupsInput {
  readonly sessions: readonly SessionSummary[]
  readonly currentProjectPath: string | null
  readonly recentProjects: readonly string[]
  readonly sortMode: SidebarSessionSortMode
  /**
   * Sessions rendered in the Pinned section, hoisted out of their project group so no
   * session is listed twice. Project ordering is unaffected: a group keeps its
   * created/updated metrics from all of its sessions, so pinning never reorders projects.
   */
  readonly pinnedSessionIds?: readonly string[]
  /**
   * The unfiltered session list, used only to populate `allSessions`.
   *
   * Defaults to `sessions`, which is correct when nothing is filtered and keeps existing callers
   * and tests working unchanged.
   */
  readonly allSessions?: readonly SessionSummary[]
}

function normalizedProjectPath(path: string | null) {
  const trimmed = path?.trim()
  return trimmed ? trimmed : null
}

function sortSessions(sessions: readonly SessionSummary[], sortMode: SidebarSessionSortMode) {
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

function latestUpdatedAt(sessions: readonly SessionSummary[]) {
  return sessions.reduce((latest, session) => Math.max(latest, session.updatedAt), EMPTY_UPDATED_AT)
}

function firstSessionCreatedAt(sessions: readonly SessionSummary[]) {
  if (sessions.length === 0) {
    return EMPTY_CREATED_AT
  }
  return sessions.reduce(
    (earliest, session) => Math.min(earliest, session.createdAt),
    Number.MAX_SAFE_INTEGER,
  )
}

function addUniqueProjectPath(paths: string[], path: string | null) {
  const normalized = normalizedProjectPath(path)
  if (!normalized || paths.includes(normalized)) {
    return false
  }
  paths.push(normalized)
  return true
}

export function buildSidebarProjectGroups({
  sessions,
  currentProjectPath,
  recentProjects,
  sortMode,
  pinnedSessionIds = [],
  allSessions,
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

  const sessionProjectPaths = [...sessionsByProject.keys()].sort((left, right) => {
    const leftCreatedAt = firstSessionCreatedAt(sessionsByProject.get(left) ?? [])
    const rightCreatedAt = firstSessionCreatedAt(sessionsByProject.get(right) ?? [])
    return rightCreatedAt - leftCreatedAt
  })

  const sessionlessProjectPaths: string[] = []
  for (const projectPath of recentProjects) {
    if (!sessionsByProject.has(projectPath)) {
      addUniqueProjectPath(sessionlessProjectPaths, projectPath)
    }
  }
  const normalizedCurrentProjectPath = normalizedProjectPath(currentProjectPath)
  if (normalizedCurrentProjectPath && !sessionsByProject.has(normalizedCurrentProjectPath)) {
    addUniqueProjectPath(sessionlessProjectPaths, normalizedCurrentProjectPath)
  }

  const projectPaths = [...sessionProjectPaths, ...sessionlessProjectPaths]
  const pinned = new Set(pinnedSessionIds.map(String))

  // Keyed by the same normalisation the visible grouping uses, so a project resolves identically.
  const allByProject = new Map<string, SessionSummary[]>()
  for (const session of allSessions ?? sessions) {
    const key = normalizedProjectPath(session.projectPath)
    if (key === null) continue
    const bucket = allByProject.get(key)
    if (bucket === undefined) allByProject.set(key, [session])
    else bucket.push(session)
  }

  return {
    projects: projectPaths.map((projectPath) => {
      const projectSessions = sessionsByProject.get(projectPath) ?? []
      const unpinnedSessions = projectSessions.filter((session) => !pinned.has(String(session.id)))
      return {
        projectPath,
        sessions: sortSessions(unpinnedSessions, sortMode),
        firstSessionCreatedAt: firstSessionCreatedAt(projectSessions),
        latestUpdatedAt: latestUpdatedAt(projectSessions),
        hoistedPinnedCount: projectSessions.length - unpinnedSessions.length,
        allSessions: sortSessions(allByProject.get(projectPath) ?? projectSessions, sortMode),
      }
    }),
  }
}
