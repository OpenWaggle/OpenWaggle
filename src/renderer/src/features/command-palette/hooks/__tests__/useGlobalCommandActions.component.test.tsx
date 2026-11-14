import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, renderHook, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { isSessionSummaryPanelVisible, useSessionSummaryUIStore } from '@/features/session-summary'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'

/*
 * Only the preload and the router are replaced: the chat, session, preference, UI and Session
 * Summary stores and the project, session and terminal hooks are the real ones, so each case
 * asserts what the app ends up showing or holding.
 */
const SESSION_ID = SessionId('session-1')
const MODEL = SupportedModelId('openai/gpt-5')

const ipc = vi.hoisted(() => ({
  compactSession: vi.fn(),
  getSessionDetail: vi.fn(),
  getSessionWorkspace: vi.fn(),
  selectProjectFolder: vi.fn(),
  updateSettings: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    compactSession: ipc.compactSession,
    getSessionDetail: ipc.getSessionDetail,
    getSessionWorkspace: ipc.getSessionWorkspace,
    selectProjectFolder: ipc.selectProjectFolder,
    updateSettings: ipc.updateSettings,
  }),
}))
// The palette navigates the app route tree, which a hook test does not build.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => ipc.navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: '/' } }),
}))

import { useGlobalCommandActions } from '../useGlobalCommandActions'

function session(title: string) {
  return fromPartial<SessionDetail>({
    id: SESSION_ID,
    title,
    projectPath: '/repo',
    executionModel: MODEL,
    messages: [],
  })
}

const initialChat = useChatStore.getInitialState()
const initialSessions = useSessionStore.getInitialState()
const initialPreferences = usePreferencesStore.getInitialState()
const initialProviders = useProviderStore.getInitialState()
const initialUI = useUIStore.getInitialState()
const initialSummary = useSessionSummaryUIStore.getInitialState()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  ipc.compactSession.mockResolvedValue({ compacted: true })
  ipc.getSessionDetail.mockResolvedValue(session('Compacted session'))
  ipc.getSessionWorkspace.mockResolvedValue(null)
  ipc.updateSettings.mockResolvedValue({ ok: true })
  usePreferencesStore.setState({
    settings: { ...DEFAULT_SETTINGS, projectPath: '/repo', selectedModel: MODEL },
  })
  useChatStore.setState({ activeSessionId: SESSION_ID, activeSession: session('Before') })
  useUIStore.setState({ commandSurface: 'commands' })
})

afterEach(() => {
  useChatStore.setState(initialChat, true)
  useSessionStore.setState(initialSessions, true)
  usePreferencesStore.setState(initialPreferences, true)
  useProviderStore.setState(initialProviders, true)
  useUIStore.setState(initialUI, true)
  useSessionSummaryUIStore.setState(initialSummary, true)
})

const toast = () => useUIStore.getState().toastData

describe('useGlobalCommandActions', () => {
  it('re-reads the Session detail and workspace after compacting', async () => {
    const { result } = renderHook(() => useGlobalCommandActions())

    await act(() => result.current.actions.compactSession())

    expect(ipc.compactSession).toHaveBeenCalledWith(SESSION_ID, MODEL)
    expect(useChatStore.getState().activeSession?.title).toBe('Compacted session')
    expect(ipc.getSessionWorkspace).toHaveBeenCalledWith(SESSION_ID, undefined, expect.anything())
    expect(toast()).toMatchObject({ message: 'Session compacted.', variant: 'success' })
  })

  it('shows the Host reason without Electron transport context when compaction is refused', async () => {
    ipc.compactSession.mockRejectedValue(
      new Error(
        "Error invoking remote method 'agent:compact-session': Error: Nothing to compact (session too small)",
      ),
    )
    const { result } = renderHook(() => useGlobalCommandActions())

    await act(() => result.current.actions.compactSession())

    expect(toast()).toMatchObject({
      message: 'Nothing to compact (session too small)',
      variant: 'error',
    })
    expect(useChatStore.getState().activeSession?.title).toBe('Before')
  })

  it('toggles the available active Session Summary from the command surface', () => {
    useSessionSummaryUIStore.getState().syncPanel('session-1', {
      available: true,
      autoHidden: false,
      rightSidebarOpen: false,
    })
    const { result } = renderHook(() => useGlobalCommandActions())

    act(() => result.current.actions.toggleSessionSummary())

    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-1']),
    ).toBe(false)
    // The toggle leaves the command surface to the caller.
    expect(useUIStore.getState().commandSurface).toBe('commands')
  })

  it('explains why a draft session cannot open Session Summary', () => {
    const { result } = renderHook(() => useGlobalCommandActions())

    act(() => result.current.actions.toggleSessionSummary())

    expect(toast()).toMatchObject({
      message: 'Send the first message before opening Session Summary.',
      variant: 'error',
    })
  })

  // The palette fires selectProject with `void`, so a transient IPC failure in the folder pick
  // or the project-path write used to float as an unhandled renderer rejection (Sentry issue
  // OPENWAGGLE-6). The Session is not started, so nothing else runs.
  it.each([
    {
      step: 'project-path write',
      mode: 'new' as const,
      arrange: () => {
        ipc.selectProjectFolder.mockResolvedValue('/chosen-project')
        ipc.updateSettings.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443'))
      },
    },
    {
      step: 'folder pick',
      mode: 'open' as const,
      arrange: () => {
        ipc.selectProjectFolder.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443'))
      },
    },
  ])('settles a failed $step instead of floating its rejection', async ({ mode, arrange }) => {
    arrange()
    const { result } = renderHook(() => useGlobalCommandActions())

    await act(() => result.current.actions.selectProject(mode))

    await waitFor(() =>
      expect(toast()).toMatchObject({
        message: 'connect ECONNREFUSED 127.0.0.1:443',
        variant: 'error',
      }),
    )
    expect(useUIStore.getState().commandSurface).toBeNull()
    expect(usePreferencesStore.getState().settings.projectPath).toBe('/repo')
    expect(useChatStore.getState().draftSession).toBeNull()
    expect(ipc.navigate).not.toHaveBeenCalled()
  })
})
