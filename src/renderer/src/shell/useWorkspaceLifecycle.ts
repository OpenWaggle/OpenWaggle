import { SessionId } from '@shared/types/brand'
import { type UseHotkeyDefinition, useHotkeys } from '@tanstack/react-hotkeys'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { sessionFollowUpQueueOptions, useChat } from '@/features/chat/hooks'
import { focusPendingRequest } from '@/features/chat/lib'
import { useDiffRouteNavigation } from '@/features/diff-panel/hooks'
import { useGit, useGitRefresh } from '@/features/git/hooks'
import { useProject, useSessionStatusMonitor, useSessions } from '@/features/sessions/hooks'
import { usePreferencesStore } from '@/features/settings/state'
import { usePinnedSessionShortcuts, useSidebarSearchShortcut } from '@/features/sidebar/hooks'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'

const SESSION_QUERY_ROOT_SEGMENTS = 2

type ChatLifecycle = Pick<
  ReturnType<typeof useChat>,
  'activeSessionId' | 'loadSessions' | 'refreshSession' | 'updateSessionTitle'
>
type SessionTreeLifecycle = Pick<
  ReturnType<typeof useSessions>,
  'loadSessions' | 'refreshSessionTree'
>

interface PendingSessionHostRefresh {
  readonly sessionIds: Set<string>
  readonly queueSessionIds: Set<string>
  catalog: boolean
  scheduled: boolean
}

function acceptsHostEvent(
  cursor: { readonly hostInstanceId: string; readonly sequence: number },
  previous: { readonly hostInstanceId: string; readonly sequence: number } | null,
) {
  return !previous ||
    cursor.hostInstanceId !== previous.hostInstanceId ||
    cursor.sequence > previous.sequence
    ? cursor
    : null
}

function useSessionHostRefresh(input: {
  readonly activeSessionId: ChatLifecycle['activeSessionId']
  readonly loadSessionTrees: SessionTreeLifecycle['loadSessions']
  readonly refreshSession: ChatLifecycle['refreshSession']
  readonly refreshSessionTree: SessionTreeLifecycle['refreshSessionTree']
  readonly updateSessionTitle: ChatLifecycle['updateSessionTitle']
}) {
  const {
    activeSessionId,
    loadSessionTrees,
    refreshSession,
    refreshSessionTree,
    updateSessionTitle,
  } = input
  const queryClient = useQueryClient()
  const latestHostCursor = useRef<{
    readonly hostInstanceId: string
    readonly sequence: number
  } | null>(null)
  const pendingRefresh = useRef<PendingSessionHostRefresh>({
    sessionIds: new Set(),
    queueSessionIds: new Set(),
    catalog: false,
    scheduled: false,
  })
  useEffect(
    () =>
      api.onSessionTitleUpdated(({ sessionId, title }) => {
        updateSessionTitle(sessionId, title)
      }),
    [updateSessionTitle],
  )
  useEffect(() => {
    let active = true
    const flush = () => {
      if (!active) return
      const pending = pendingRefresh.current
      pending.scheduled = false
      const refreshCatalog = pending.catalog
      const refreshActive = activeSessionId ? pending.sessionIds.has(activeSessionId) : false
      const queueSessionIds = [...pending.queueSessionIds]
      pending.catalog = false
      pending.sessionIds.clear()
      pending.queueSessionIds.clear()
      for (const sessionId of queueSessionIds) {
        void queryClient.invalidateQueries(sessionFollowUpQueueOptions(SessionId(sessionId)))
      }
      if (refreshCatalog) void loadSessionTrees()
      if (refreshActive && activeSessionId) {
        void refreshSession(activeSessionId)
        void refreshSessionTree(SessionId(String(activeSessionId)))
      }
    }
    const schedule = () => {
      if (pendingRefresh.current.scheduled) return
      pendingRefresh.current.scheduled = true
      queueMicrotask(flush)
    }
    const unsubscribe = api.onSessionHostEvent((event) => {
      const accepted = acceptsHostEvent(event.cursor, latestHostCursor.current)
      if (!accepted) return
      latestHostCursor.current = accepted
      if (event.payload.kind === 'semantic-discovery-readiness-changed') return
      const { sessionId } = event.payload
      pendingRefresh.current.sessionIds.add(sessionId)
      if (
        event.payload.kind === 'session-state-changed' ||
        event.payload.kind === 'session-list-changed'
      ) {
        pendingRefresh.current.catalog = true
        pendingRefresh.current.queueSessionIds.add(sessionId)
      }
      schedule()
    })
    return () => {
      active = false
      pendingRefresh.current.scheduled = false
      pendingRefresh.current.catalog = false
      pendingRefresh.current.sessionIds.clear()
      pendingRefresh.current.queueSessionIds.clear()
      unsubscribe()
    }
  }, [activeSessionId, loadSessionTrees, queryClient, refreshSession, refreshSessionTree])
  useEffect(() => {
    return api.onSessionHostResyncRequired(() => {
      const queryKey = sessionFollowUpQueueOptions(null).queryKey.slice(
        0,
        SESSION_QUERY_ROOT_SEGMENTS,
      )
      void queryClient.invalidateQueries({ queryKey })
      void loadSessionTrees()
      if (activeSessionId) {
        void refreshSession(activeSessionId)
        void refreshSessionTree(SessionId(String(activeSessionId)))
      }
    })
  }, [activeSessionId, loadSessionTrees, queryClient, refreshSession, refreshSessionTree])
}

export function useWorkspaceLifecycle(): void {
  const { projectPath } = useProject()
  const {
    activeSessionId,
    startDraftSession,
    loadSessions: loadChatSessions,
    refreshSession,
    updateSessionTitle,
  } = useChat()
  const { loadSessions: loadSessionTrees, refreshSessionTree } = useSessions()
  const {
    refreshStatus: refreshGitStatus,
    refreshBranches: refreshGitBranches,
    workingPath,
    repositoryPath,
  } = useGit()

  const navigate = useNavigate()
  const toggleTerminal = useUIStore((s) => s.toggleTerminal)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const openCommandSurface = useUIStore((s) => s.openCommandSurface)
  const closeCommandSurface = useUIStore((s) => s.closeCommandSurface)
  const commandSurface = useUIStore((s) => s.commandSurface)
  const shortcutBindings = usePreferencesStore((s) => s.settings.shortcutBindings)
  const { toggleDiff, toggleSessionTree } = useDiffRouteNavigation()

  function startDraftSessionRoute() {
    closeCommandSurface()
    startDraftSession(projectPath)
    void navigate({ to: '/' })
  }

  useSessionHostRefresh({
    activeSessionId,
    loadSessionTrees,
    refreshSession,
    refreshSessionTree,
    updateSessionTitle,
  })

  useEffect(() => {
    void loadChatSessions()
    void loadSessionTrees()
  }, [loadChatSessions, loadSessionTrees])

  useEffect(() => {
    // Status follows the active session's working tree; the branch list is
    // repository-level (ADR 0018).
    void refreshGitStatus(workingPath)
    void refreshGitBranches(repositoryPath)
  }, [workingPath, repositoryPath, refreshGitStatus, refreshGitBranches])

  useGitRefresh({
    workingPath,
    repositoryPath,
    activeSessionId,
    refreshGitStatus,
    refreshGitBranches,
    refreshSession,
  })

  useEffect(() => {
    void refreshSessionTree(activeSessionId ? SessionId(String(activeSessionId)) : null)
  }, [activeSessionId, refreshSessionTree])

  useSessionStatusMonitor()
  usePinnedSessionShortcuts()
  useSidebarSearchShortcut()

  const hotkeys: UseHotkeyDefinition[] = [
    {
      binding: shortcutBindings['commandPalette.toggle'],
      callback: () =>
        commandSurface === 'commands' ? closeCommandSurface() : openCommandSurface('commands'),
    },
    {
      binding: shortcutBindings['filePicker.toggle'],
      callback: () =>
        commandSurface === 'files' ? closeCommandSurface() : openCommandSurface('files'),
    },
    {
      binding: shortcutBindings['chat.new'],
      callback: startDraftSessionRoute,
    },
    {
      binding: shortcutBindings['terminal.toggle'],
      callback: toggleTerminal,
    },
    {
      binding: shortcutBindings['sidebar.toggle'],
      callback: toggleSidebar,
    },
    {
      binding: shortcutBindings['diff.toggle'],
      callback: toggleDiff,
    },
    {
      binding: shortcutBindings['sessionTree.toggle'],
      callback: toggleSessionTree,
    },
    {
      binding: shortcutBindings['request.focus'],
      callback: focusPendingRequest,
    },
  ].flatMap((item) => (item.binding ? [{ hotkey: item.binding, callback: item.callback }] : []))

  useHotkeys(hotkeys, { preventDefault: true })
}
