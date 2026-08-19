import { SessionId } from '@shared/types/brand'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
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
import { useSidebarFilterStore } from '../state/sidebar-filter-store'
import { isProjectExpanded, useSidebarViewStore } from '../state/sidebar-view-store'
import { activeViewFromPathname } from './sidebar-view'
import { useSidebarRowStates } from './useSidebarRowStates'

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

  /*
   * Chip counts come from every session, the tree from the filtered set. Counting after
   * filtering would leave one chip on screen and hide the states the user wants to switch to.
   */
  const rowStates = useSidebarRowStates(sessions.sessions)
  const filterState = useSidebarFilterStore((s) => s.activeState)
  const toggleFilterState = useSidebarFilterStore((s) => s.toggleState)
  const searchQuery = useSidebarFilterStore((s) => s.query)
  const setSearchQuery = useSidebarFilterStore((s) => s.setQuery)

  /*
   * Returns the original array when nothing is narrowed, rather than a filtered copy.
   *
   * Identity matters here: this list feeds the per-session git indicator effect, which keys its
   * memo on the array. A fresh array on every render made that effect re-run on every render,
   * which spun the renderer.
   */
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const visibleSessions = useMemo(() => {
    if (filterState === null && normalizedQuery === '') return sessions.sessions
    return sessions.sessions.filter((session) => {
      if (filterState !== null && rowStates.stateOf(session) !== filterState) return false
      if (normalizedQuery === '') return true
      // A project match keeps its sessions, so searching a repository name finds its work.
      const label = session.projectPath === null ? '' : projectName(session.projectPath)
      const custom =
        session.projectPath === null ? '' : (projectDisplayNames[session.projectPath] ?? '')
      return (
        session.title.toLowerCase().includes(normalizedQuery) ||
        label.toLowerCase().includes(normalizedQuery) ||
        custom.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [sessions.sessions, filterState, normalizedQuery, rowStates, projectDisplayNames])

  const pinnedRows = buildPinnedSessionRows({
    pins,
    sessions: visibleSessions,
    sortMode: pinnedSortMode,
  })
  const sessionGroups = buildSidebarProjectGroups({
    sessions: visibleSessions,
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
    chipCounts: rowStates.chipCounts,
    displayProjectName,
    filterState,
    projectRollUp: rowStates.rollUpFor,
    searchQuery,
    setSearchQuery,
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
    toggleFilterState,
    toggleProjectExpanded,
  }
}
