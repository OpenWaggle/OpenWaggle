import { SessionId } from '@shared/types/brand'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import { useChat } from '@/features/chat/hooks'
import { useGit } from '@/features/git/hooks'
import { useProject, useSessions } from '@/features/sessions/hooks'
import { usePreferencesStore } from '@/features/settings/state'
import { projectName } from '@/shared/lib/format'
import { useUIStore } from '@/shell/ui-store'
import { useFullscreen } from '@/shell/useFullscreen'
import { buildPinnedSessionRows } from '../lib/pinned-sessions'
import { buildSidebarProjectGroups } from '../lib/sidebar-project-groups'
import { usePinnedSessionsStore } from '../state/pinned-sessions-store'
import { isProjectExpanded, useSidebarViewStore } from '../state/sidebar-view-store'
import { activeViewFromPathname } from './sidebar-view'

type SidebarSessionsState = ReturnType<typeof useSessions>

function getMatchingActiveSessionTree(
  activeSessionId: SessionId | null,
  sessions: SidebarSessionsState,
) {
  if (!activeSessionId) return null
  const tree = sessions.activeSessionTree
  return tree?.session.id === activeSessionId ? tree : null
}

function getMatchingActiveWorkspace(
  activeSessionId: SessionId | null,
  sessions: SidebarSessionsState,
) {
  if (!activeSessionId) return null
  const workspace = sessions.activeWorkspace
  return workspace?.tree.session.id === activeSessionId ? workspace : null
}

function resolveActiveSessionState(
  activeChatSessionId: ReturnType<typeof useChat>['activeSessionId'],
  sessions: ReturnType<typeof useSessions>,
) {
  const activeSessionId = activeChatSessionId ? SessionId(String(activeChatSessionId)) : null
  const matchingActiveSessionTree = getMatchingActiveSessionTree(activeSessionId, sessions)
  const matchingActiveWorkspace = getMatchingActiveWorkspace(activeSessionId, sessions)
  const activeBranchId =
    matchingActiveWorkspace?.activeBranchId ?? matchingActiveSessionTree?.session.lastActiveBranchId

  return { activeBranchId, activeSessionId, matchingActiveSessionTree, matchingActiveWorkspace }
}

export function useSidebarState() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const showToast = useUIStore((s) => s.showToast)
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const project = useProject()
  const recentProjects = usePreferencesStore((s) => s.settings.recentProjects)
  const projectDisplayNames = usePreferencesStore((s) => s.settings.projectDisplayNames)
  const selectedModel = usePreferencesStore((s) => s.settings.selectedModel)
  const setProjectDisplayName = usePreferencesStore((s) => s.setProjectDisplayName)
  const removeProjectReferences = usePreferencesStore((s) => s.removeProjectReferences)
  const chat = useChat()
  const sessions = useSessions()
  const git = useGit()
  const isFullscreen = useFullscreen()
  // Sort mode and project expansion persist across launches, so a collapsed tree stays
  // collapsed. See sidebar-view-store for why the chip filter deliberately does not.
  const sortMode = useSidebarViewStore((s) => s.sessionSortMode)
  const setSortMode = useSidebarViewStore((s) => s.setSessionSortMode)
  const projectExpandedByPath = useSidebarViewStore((s) => s.projectExpandedByPath)
  const setProjectExpanded = useSidebarViewStore((s) => s.setProjectExpanded)
  const toggleProjectExpanded = useSidebarViewStore((s) => s.toggleProjectExpanded)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [pinnedSortMenuOpen, setPinnedSortMenuOpen] = useState(false)
  const pins = usePinnedSessionsStore((s) => s.pins)
  const pinnedSortMode = usePinnedSessionsStore((s) => s.sortMode)
  const setPinnedSortMode = usePinnedSessionsStore((s) => s.setSortMode)

  const activeSession = resolveActiveSessionState(chat.activeSessionId, sessions)
  const pinnedRows = buildPinnedSessionRows({
    pins,
    sessions: sessions.sessions,
    sortMode: pinnedSortMode,
  })
  const sessionGroups = buildSidebarProjectGroups({
    sessions: sessions.sessions,
    currentProjectPath: project.projectPath,
    recentProjects,
    sortMode,
    pinnedSessionIds: pinnedRows.map((row) => String(row.session.id)),
  })

  function displayProjectName(path: string) {
    return projectDisplayNames[path]?.trim() || projectName(path)
  }

  return {
    activeBranchId: activeSession.activeBranchId,
    activeSessionId: activeSession.activeSessionId,
    activeView: activeViewFromPathname(pathname),
    chat,
    displayProjectName,
    git,
    isFullscreen,
    isProjectCollapsed: (path: string) => !isProjectExpanded(projectExpandedByPath, path),
    matchingActiveSessionTree: activeSession.matchingActiveSessionTree,
    matchingActiveWorkspace: activeSession.matchingActiveWorkspace,
    navigate,
    pinnedRows,
    pinnedSortMenuOpen,
    pinnedSortMode,
    preferences: { removeProjectReferences, selectedModel, setProjectDisplayName },
    project,
    projectExpandedByPath,
    sessionGroups,
    sessions,
    setPinnedSortMenuOpen,
    setPinnedSortMode,
    setProjectExpanded,
    setSortMenuOpen,
    setSortMode,
    showToast,
    sidebarOpen,
    sortMenuOpen,
    sortMode,
    toggleProjectExpanded,
  }
}
