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
import {
  buildSidebarProjectGroups,
  type SidebarSessionSortMode,
} from '../lib/sidebar-project-groups'
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
  const [sortMode, setSortMode] = useState<SidebarSessionSortMode>('recent')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [collapsedProjectPaths, setCollapsedProjectPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  const activeSession = resolveActiveSessionState(chat.activeSessionId, sessions)
  const sessionGroups = buildSidebarProjectGroups({
    sessions: sessions.sessions,
    currentProjectPath: project.projectPath,
    recentProjects,
    sortMode,
  })

  function displayProjectName(path: string) {
    return projectDisplayNames[path]?.trim() || projectName(path)
  }

  return {
    activeBranchId: activeSession.activeBranchId,
    activeSessionId: activeSession.activeSessionId,
    activeView: activeViewFromPathname(pathname),
    chat,
    collapsedProjectPaths,
    displayProjectName,
    git,
    isFullscreen,
    matchingActiveSessionTree: activeSession.matchingActiveSessionTree,
    matchingActiveWorkspace: activeSession.matchingActiveWorkspace,
    navigate,
    preferences: { removeProjectReferences, selectedModel, setProjectDisplayName },
    project,
    sessionGroups,
    sessions,
    setCollapsedProjectPaths,
    setSortMenuOpen,
    setSortMode,
    showToast,
    sidebarOpen,
    sortMenuOpen,
    sortMode,
  }
}
