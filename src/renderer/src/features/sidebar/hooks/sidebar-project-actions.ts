import type { SessionSummary } from '@shared/types/session'
import type { useNavigate } from '@tanstack/react-router'
import { api } from '@/shared/lib/ipc'
import { clearComposerDraftsForSessions, errorMessage } from './sidebar-action-utils'

type Navigate = ReturnType<typeof useNavigate>

interface SidebarProjectActionDeps {
  readonly activeSessionId: string | null
  readonly displayProjectName: (path: string) => string
  readonly expandProject: (path: string) => void
  readonly loadChatSessions: () => Promise<void>
  readonly loadSessionTrees: () => Promise<void>
  readonly navigate: Navigate
  readonly projectPath: string | null
  readonly refreshGit: (path: string | null) => void
  readonly removeProjectReferences: (path: string) => Promise<void>
  readonly selectFolder: () => Promise<string | null>
  readonly sessions: readonly SessionSummary[]
  readonly setProjectDisplayName: (path: string, name: string) => Promise<void>
  readonly setProjectPath: (path: string) => Promise<void>
  readonly showToast: (message: string) => void
  readonly startDraftSession: (projectPath: string | null) => void
  readonly clearTransientDraftContext: () => void
}

function projectSessionsForPath(
  sessions: readonly SessionSummary[],
  archivedSessions: readonly SessionSummary[],
  path: string,
) {
  const byId = new Map<string, SessionSummary>()
  for (const session of sessions) {
    if (session.projectPath === path) byId.set(String(session.id), session)
  }
  for (const session of archivedSessions) {
    if (session.projectPath === path) byId.set(String(session.id), session)
  }
  return [...byId.values()]
}

function resetToDraftForProject(deps: SidebarProjectActionDeps, projectPath: string | null) {
  deps.clearTransientDraftContext()
  deps.startDraftSession(projectPath)
  if (projectPath) deps.expandProject(projectPath)
  void deps.navigate({ to: '/' })
}

async function selectProjectPath(deps: SidebarProjectActionDeps, path: string) {
  resetToDraftForProject(deps, path)
  await deps.setProjectPath(path)
  deps.refreshGit(path)
}

async function archiveProjectSessions(
  deps: SidebarProjectActionDeps,
  path: string,
  projectSessions: readonly SessionSummary[],
) {
  const sessionCount = projectSessions.length
  if (sessionCount === 0) return

  const confirmed = await api.showConfirm(
    `Archive ${sessionCount} session${sessionCount === 1 ? '' : 's'} in ${deps.displayProjectName(path)}?`,
    `Project: ${path}`,
  )
  if (!confirmed) return

  await Promise.all(projectSessions.map((session) => api.archiveSession(session.id)))
  clearComposerDraftsForSessions(projectSessions)
  await Promise.all([deps.loadChatSessions(), deps.loadSessionTrees()])

  const archivedActiveSession =
    deps.activeSessionId !== null &&
    projectSessions.some((session) => String(session.id) === deps.activeSessionId)
  if (archivedActiveSession) resetToDraftForProject(deps, deps.projectPath)
}

async function removeProject(deps: SidebarProjectActionDeps, path: string) {
  const archivedSessions = await api.listArchivedSessions()
  const projectSessions = projectSessionsForPath(deps.sessions, archivedSessions, path)
  const sessionCount = projectSessions.length
  const confirmed = await api.showConfirm(
    `Remove ${deps.displayProjectName(path)} and permanently delete ${sessionCount} session${sessionCount === 1 ? '' : 's'}?`,
    `Project: ${path}\nThis cannot be undone.`,
  )
  if (!confirmed) return

  const projectSessionIds = new Set(projectSessions.map((session) => String(session.id)))
  const activeRuns = await api.listActiveRuns()
  await Promise.all(
    activeRuns
      .filter((run) => projectSessionIds.has(String(run.sessionId)))
      .map((run) => api.cancelAgent(run.sessionId)),
  )
  await Promise.all(projectSessions.map((session) => api.deleteSession(session.id)))
  clearComposerDraftsForSessions(projectSessions)
  await deps.removeProjectReferences(path)
  await Promise.all([deps.loadChatSessions(), deps.loadSessionTrees()])

  if (projectSessionIds.has(String(deps.activeSessionId)) || deps.projectPath === path) {
    deps.startDraftSession(null)
    deps.refreshGit(null)
    void deps.navigate({ to: '/' })
  }
}

export function createSidebarProjectActions(deps: SidebarProjectActionDeps) {
  return {
    archiveSessions(path: string, projectSessions: readonly SessionSummary[]) {
      void archiveProjectSessions(deps, path, projectSessions).catch((error: unknown) => {
        deps.showToast(`Failed to archive project sessions: ${errorMessage(error)}`)
      })
    },
    async openProject() {
      const path = await deps.selectFolder()
      if (!path) return
      try {
        await selectProjectPath(deps, path)
      } catch (error) {
        deps.showToast(`Failed to select project: ${errorMessage(error)}`)
      }
    },
    openInFinder(path: string) {
      void api.openPath(path).catch((error: unknown) => {
        deps.showToast(`Failed to open project folder: ${errorMessage(error)}`)
      })
    },
    remove(path: string) {
      void removeProject(deps, path).catch((error: unknown) => {
        deps.showToast(`Failed to remove project: ${errorMessage(error)}`)
      })
    },
    rename(path: string, name: string) {
      void deps.setProjectDisplayName(path, name).catch((error: unknown) => {
        deps.showToast(`Failed to rename project: ${errorMessage(error)}`)
      })
    },
    async selectProjectPath(path: string) {
      try {
        await selectProjectPath(deps, path)
      } catch (error) {
        deps.showToast(`Failed to select project: ${errorMessage(error)}`)
      }
    },
  }
}
