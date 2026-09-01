import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import { useSidebarViewStore } from '../../state/sidebar-view-store'
import { Sidebar } from '../Sidebar'

const {
  archiveSessionMock,
  cancelAgentMock,
  deleteSessionMock,
  getGitStatusMock,
  getProjectPreferencesMock,
  getProviderModelsMock,
  listActiveRunsMock,
  listArchivedSessionsMock,
  listGitBranchesMock,
  listSessionsByIdsMock,
  navigateMock,
  openPathMock,
  routerState,
  showConfirmMock,
  querySessionControlMock,
  updateSettingsMock,
} = vi.hoisted(() => ({
  archiveSessionMock: vi.fn(),
  cancelAgentMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  getGitStatusMock: vi.fn(),
  getProjectPreferencesMock: vi.fn(),
  getProviderModelsMock: vi.fn(),
  listActiveRunsMock: vi.fn(),
  listArchivedSessionsMock: vi.fn(),
  listGitBranchesMock: vi.fn(),
  listSessionsByIdsMock: vi.fn(),
  navigateMock: vi.fn(),
  openPathMock: vi.fn(),
  routerState: { pathname: '/' },
  showConfirmMock: vi.fn(),
  querySessionControlMock: vi.fn(),
  updateSettingsMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useRouterState: (options: {
    readonly select: (state: { readonly location: { readonly pathname: string } }) => string
  }) => options.select({ location: { pathname: routerState.pathname } }),
}))

vi.mock('@/shell/useFullscreen', () => ({
  useFullscreen: () => false,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    archiveSession: archiveSessionMock,
    cancelAgent: cancelAgentMock,
    deleteSession: deleteSessionMock,
    getGitStatus: getGitStatusMock,
    onGitWorkingTreeChanged: () => () => {},
    getProjectPreferences: getProjectPreferencesMock,
    getProviderModels: getProviderModelsMock,
    listActiveRuns: listActiveRunsMock,
    listArchivedSessions: listArchivedSessionsMock,
    listGitBranches: listGitBranchesMock,
    listSessionsByIds: listSessionsByIdsMock,
    openPath: openPathMock,
    showConfirm: showConfirmMock,
    querySessionControl: querySessionControlMock,
    updateSettings: updateSettingsMock,
  },
}))

const PROJECT_PATH = '/repo/openwaggle'
const SESSION_ID = SessionId('session-project-1')
function makeSession(): SessionSummary {
  return {
    id: SESSION_ID,
    title: 'Existing project session',
    projectPath: PROJECT_PATH,
    createdAt: 10,
    updatedAt: 20,
  }
}

function resetStores(session = makeSession()) {
  usePreferencesStore.setState({
    ...usePreferencesStore.getInitialState(),
    settings: {
      ...DEFAULT_SETTINGS,
      projectPath: PROJECT_PATH,
      selectedModel: SupportedModelId('openai/gpt-5'),
      recentProjects: [PROJECT_PATH],
    },
    isLoaded: true,
  })
  useProviderStore.setState({
    ...useProviderStore.getInitialState(),
    baseProviderModels: [],
    providerModels: [],
  })
  useChatStore.setState({
    sessions: [session],
    sessionById: new Map(),
    missingSessionIds: new Set(),
    draftSession: null,
    activeSessionId: SESSION_ID,
    activeSession: null,
    error: null,
  })
  useSessionStore.setState({
    ...useSessionStore.getInitialState(),
    sessions: [session],
    activeSessionTree: null,
    activeWorkspace: null,
    draftBranch: null,
  })
  useSessionStatusStore.setState({
    statuses: new Map(),
    completedAt: new Map(),
    lastVisitedAt: new Map(),
  })
  useUIStore.setState({
    ...useUIStore.getInitialState(),
    sidebarOpen: true,
  })
  useSidebarViewStore.setState({ sessionSortMode: 'recent', projectExpandedByPath: {} })
}

describe('Sidebar project actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routerState.pathname = '/'
    archiveSessionMock.mockResolvedValue(undefined)
    deleteSessionMock.mockResolvedValue(undefined)
    getGitStatusMock.mockResolvedValue(null)
    getProjectPreferencesMock.mockResolvedValue(null)
    getProviderModelsMock.mockResolvedValue([])
    listActiveRunsMock.mockResolvedValue([])
    listArchivedSessionsMock.mockResolvedValue([])
    listGitBranchesMock.mockResolvedValue({ ok: true, branches: [] })
    listSessionsByIdsMock.mockResolvedValue([makeSession()])
    querySessionControlMock.mockImplementation(
      async (request: { query: { archived?: boolean } }) => ({
        contractVersion: 2,
        requestId: 'project-sessions',
        outcome: {
          operation: 'list',
          sessions: request.query.archived
            ? []
            : [
                {
                  sessionId: SESSION_ID,
                  title: 'Existing project session',
                  projectPath: PROJECT_PATH,
                  archived: false,
                  createdAt: 10,
                  updatedAt: 20,
                  lineageRole: 'independent',
                  directWorkerCount: 0,
                },
              ],
        },
      }),
    )
    openPathMock.mockResolvedValue(undefined)
    showConfirmMock.mockResolvedValue(false)
    updateSettingsMock.mockResolvedValue({ ok: true })
    resetStores()
  })

  it('uses the project row as a disclosure toggle without selecting a new draft', () => {
    render(<Sidebar />)

    expect(screen.getByText('Existing project session')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /collapse openwaggle/i }))

    expect(screen.queryByText('Existing project session')).toBeNull()
    expect(updateSettingsMock).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('records a collapsed project in the persisted view store', () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: /collapse openwaggle/i }))

    expect(useSidebarViewStore.getState().projectExpandedByPath).toEqual({
      [PROJECT_PATH]: false,
    })
  })

  it('renders a project collapsed when the restored state says so', () => {
    useSidebarViewStore.setState({ projectExpandedByPath: { [PROJECT_PATH]: false } })

    render(<Sidebar />)

    expect(screen.queryByText('Existing project session')).toBeNull()
    expect(screen.getByRole('button', { name: /expand openwaggle/i })).toBeInTheDocument()
  })

  it('treats a project it has never seen as expanded', () => {
    render(<Sidebar />)

    expect(screen.getByText('Existing project session')).toBeInTheDocument()
  })

  it('hides collapsed sidebar contents from accessibility and hit testing', () => {
    useUIStore.setState({ sidebarOpen: false })

    const { container } = render(<Sidebar />)
    const sidebarWrapper = container.firstElementChild

    expect(sidebarWrapper).toHaveAttribute('aria-hidden', 'true')
    expect(sidebarWrapper).toHaveAttribute('inert')
    expect(sidebarWrapper).toHaveClass('pointer-events-none', 'w-0')
    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull()
  })

  it('hides the app sidebar while the settings overlay is active', () => {
    routerState.pathname = '/settings'

    const { container } = render(<Sidebar />)
    const sidebarWrapper = container.firstElementChild

    expect(sidebarWrapper).toHaveAttribute('aria-hidden', 'true')
    expect(sidebarWrapper).toHaveAttribute('inert')
    expect(sidebarWrapper).toHaveClass('pointer-events-none', 'w-0')
    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull()
  })

  it('starts a draft for a project from the hover new-session action', async () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: /new session in openwaggle/i }))

    await waitFor(() => {
      expect(useChatStore.getState().activeSessionId).toBeNull()
      expect(useChatStore.getState().draftSession).toEqual({ projectPath: PROJECT_PATH })
      expect(usePreferencesStore.getState().settings.projectPath).toBe(PROJECT_PATH)
      expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
    })
    const draftRow = screen.getByRole('button', { name: /draft session in openwaggle/i })
    expect(draftRow).toBeInTheDocument()
    expect(draftRow).toHaveClass('w-full', 'bg-bg-active')
    expect(draftRow).not.toHaveClass('mx-2')
  })

  it('opens the project folder from the project action menu', async () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: /open project actions for openwaggle/i }))
    fireEvent.click(screen.getByRole('button', { name: /open in finder/i }))

    await waitFor(() => {
      expect(openPathMock).toHaveBeenCalledWith(PROJECT_PATH)
    })
  })
})
