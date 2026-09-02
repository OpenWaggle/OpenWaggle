import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { type ShortcutBinding, shortcutBindingKey } from '@shared/types/shortcuts'
import { type Mock, vi } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
import { usePreferencesStore, useSyntaxThemeCatalogStore } from '@/features/settings'
import { useUIStore } from '../ui-store'

type TitleUpdatedPayload = IpcEventChannelMap['sessions:title-updated']['payload']
type TitleUpdatedHandler = (payload: TitleUpdatedPayload) => void
type SessionHostEventHandler = (event: SessionHostEventEnvelope) => void
type SessionHostResyncHandler = (payload: { readonly reason: 'slow-consumer' }) => void
interface HotkeyBinding {
  readonly hotkey: ShortcutBinding
  readonly callback: () => void
}

interface WorkspaceLifecycleMocks {
  projectPath: string
  workingPath: string
  activeSessionId: string
  readonly loadChatSessions: Mock
  readonly startDraftSession: Mock
  readonly refreshSession: Mock
  readonly updateSessionTitle: Mock
  readonly loadSessionTrees: Mock
  readonly refreshCatalogSessions: Mock
  readonly refreshSessionTree: Mock
  readonly refreshGitStatus: Mock
  readonly refreshGitBranches: Mock
  readonly loadSyntaxResources: Mock
  readonly navigate: Mock
  readonly toggleDiff: Mock
  readonly toggleSessionTree: Mock
  readonly useGitRefresh: Mock
  readonly useSessionStatusMonitor: Mock
  readonly titleUnsubscribe: Mock
  readonly hotkeys: HotkeyBinding[]
  readonly singleHotkeys: { readonly hotkey: unknown; readonly callback: () => void }[]
  readonly getTitleUpdatedHandler: () => TitleUpdatedHandler | null
  readonly getSessionHostEventHandler: () => SessionHostEventHandler | null
  readonly getSessionHostResyncHandler: () => SessionHostResyncHandler | null
  readonly onSessionTitleUpdated: Mock
  readonly onSessionHostEvent: Mock
  readonly onSessionHostResyncRequired: Mock
  readonly invalidateQueries: Mock
}

const lifecycleMocks: WorkspaceLifecycleMocks = vi.hoisted(() => {
  let titleUpdatedHandler: TitleUpdatedHandler | null = null
  let sessionHostEventHandler: SessionHostEventHandler | null = null
  let sessionHostResyncHandler: SessionHostResyncHandler | null = null
  const titleUnsubscribe = vi.fn()
  const hotkeys: HotkeyBinding[] = []
  const singleHotkeys: { readonly hotkey: unknown; readonly callback: () => void }[] = []
  return {
    projectPath: '/repo',
    workingPath: '/repo/.worktrees/session-1',
    activeSessionId: 'session-1',
    loadChatSessions: vi.fn().mockResolvedValue(undefined),
    startDraftSession: vi.fn(),
    refreshSession: vi.fn().mockResolvedValue(undefined),
    updateSessionTitle: vi.fn(),
    loadSessionTrees: vi.fn().mockResolvedValue(undefined),
    refreshCatalogSessions: vi.fn().mockResolvedValue(undefined),
    refreshSessionTree: vi.fn().mockResolvedValue(undefined),
    refreshGitStatus: vi.fn().mockResolvedValue(undefined),
    refreshGitBranches: vi.fn().mockResolvedValue(undefined),
    loadSyntaxResources: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn(),
    toggleDiff: vi.fn(),
    toggleSessionTree: vi.fn(),
    useGitRefresh: vi.fn(),
    useSessionStatusMonitor: vi.fn(),
    titleUnsubscribe,
    hotkeys,
    singleHotkeys,
    getTitleUpdatedHandler: () => titleUpdatedHandler,
    getSessionHostEventHandler: () => sessionHostEventHandler,
    getSessionHostResyncHandler: () => sessionHostResyncHandler,
    onSessionTitleUpdated: vi.fn((handler: TitleUpdatedHandler) => {
      titleUpdatedHandler = handler
      return titleUnsubscribe
    }),
    onSessionHostEvent: vi.fn((handler: SessionHostEventHandler) => {
      sessionHostEventHandler = handler
      return vi.fn()
    }),
    onSessionHostResyncRequired: vi.fn((handler: SessionHostResyncHandler) => {
      sessionHostResyncHandler = handler
      return vi.fn()
    }),
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }
})

export function getWorkspaceLifecycleMocks(): WorkspaceLifecycleMocks {
  return lifecycleMocks
}

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: lifecycleMocks.invalidateQueries }),
}))

vi.mock('@tanstack/react-hotkeys', () => ({
  useHotkeys: (bindings: readonly HotkeyBinding[]) => {
    lifecycleMocks.hotkeys.length = 0
    lifecycleMocks.singleHotkeys.length = 0
    lifecycleMocks.hotkeys.push(...bindings)
  },
  /* Single registrations stay separate so they cannot clear the workspace binding array. */
  useHotkey: (hotkey: unknown, callback: () => void) => {
    lifecycleMocks.singleHotkeys.push({ hotkey, callback })
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => lifecycleMocks.navigate,
  useLocation: () => ({ pathname: '/' }),
}))

vi.mock('@/features/chat/hooks', () => ({
  sessionFollowUpQueueOptions: (sessionId: string | null) => ({
    queryKey: ['sessions', 'follow-up-queue', sessionId],
  }),
  useChat: () => ({
    activeSessionId: lifecycleMocks.activeSessionId,
    startDraftSession: lifecycleMocks.startDraftSession,
    loadSessions: lifecycleMocks.loadChatSessions,
    refreshSession: lifecycleMocks.refreshSession,
    updateSessionTitle: lifecycleMocks.updateSessionTitle,
  }),
}))

vi.mock('@/features/diff-panel/hooks', () => ({
  useDiffRouteNavigation: () => ({
    toggleDiff: lifecycleMocks.toggleDiff,
    toggleSessionTree: lifecycleMocks.toggleSessionTree,
  }),
}))

vi.mock('@/features/git/hooks', () => ({
  useGit: () => ({
    refreshStatus: lifecycleMocks.refreshGitStatus,
    refreshBranches: lifecycleMocks.refreshGitBranches,
    workingPath: lifecycleMocks.workingPath,
    repositoryPath: lifecycleMocks.projectPath,
  }),
  useGitRefresh: lifecycleMocks.useGitRefresh,
}))

vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: lifecycleMocks.projectPath }),
  useSessions: () => ({
    loadSessions: lifecycleMocks.loadSessionTrees,
    refreshCatalogSessions: lifecycleMocks.refreshCatalogSessions,
    refreshSessionTree: lifecycleMocks.refreshSessionTree,
    sessions: [],
  }),
  useSessionStatusMonitor: lifecycleMocks.useSessionStatusMonitor,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    onSessionTitleUpdated: lifecycleMocks.onSessionTitleUpdated,
    onSessionHostEvent: lifecycleMocks.onSessionHostEvent,
    onSessionHostResyncRequired: lifecycleMocks.onSessionHostResyncRequired,
  },
}))

export function runWorkspaceHotkey(hotkey: string) {
  const binding = lifecycleMocks.hotkeys.find(
    (candidate) => shortcutBindingKey(candidate.hotkey) === hotkey,
  )
  if (!binding) throw new Error(`Expected hotkey ${hotkey}`)
  binding.callback()
}

export function resetWorkspaceLifecycleMocks() {
  useUIStore.setState({ sidebarOpen: true, terminalOpen: false, slashCommandMenuOpen: false })
  usePreferencesStore.setState({
    settings: { ...DEFAULT_SETTINGS, projectPath: '/repo' },
    isLoaded: true,
    loadError: null,
  })
  useSessionStatusStore.setState({
    statuses: new Map(),
    completedAt: new Map(),
    lastVisitedAt: new Map(),
    phases: new Map(),
  })
  lifecycleMocks.loadChatSessions.mockClear()
  lifecycleMocks.startDraftSession.mockClear()
  lifecycleMocks.loadSessionTrees.mockClear()
  lifecycleMocks.refreshCatalogSessions.mockClear()
  lifecycleMocks.refreshSession.mockClear()
  lifecycleMocks.refreshGitStatus.mockClear()
  lifecycleMocks.refreshGitBranches.mockClear()
  lifecycleMocks.loadSyntaxResources.mockClear()
  lifecycleMocks.refreshSessionTree.mockClear()
  lifecycleMocks.updateSessionTitle.mockClear()
  lifecycleMocks.navigate.mockClear()
  lifecycleMocks.toggleDiff.mockClear()
  lifecycleMocks.toggleSessionTree.mockClear()
  lifecycleMocks.useGitRefresh.mockClear()
  lifecycleMocks.useSessionStatusMonitor.mockClear()
  lifecycleMocks.onSessionTitleUpdated.mockClear()
  lifecycleMocks.onSessionHostEvent.mockClear()
  lifecycleMocks.onSessionHostResyncRequired.mockClear()
  lifecycleMocks.invalidateQueries.mockClear()
  lifecycleMocks.titleUnsubscribe.mockClear()
  lifecycleMocks.hotkeys.length = 0
  lifecycleMocks.projectPath = '/repo'
  lifecycleMocks.workingPath = '/repo/.worktrees/session-1'
  lifecycleMocks.activeSessionId = 'session-1'
  useSyntaxThemeCatalogStore.setState({ load: lifecycleMocks.loadSyntaxResources })
}

export function loadUseWorkspaceLifecycle() {
  return import('../useWorkspaceLifecycle')
}
