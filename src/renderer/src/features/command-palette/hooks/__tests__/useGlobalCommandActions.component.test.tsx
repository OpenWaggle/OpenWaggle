import { SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  compactSession: vi.fn(),
  navigate: vi.fn(),
  refreshSession: vi.fn(),
  refreshSessionWorkspace: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/features/chat/hooks', () => ({
  useChat: () => ({
    sessions: [],
    activeSessionId: SessionId('session-1'),
    setActiveSession: vi.fn(),
    startDraftSession: vi.fn(),
    refreshSession: mocks.refreshSession,
  }),
}))
vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: '/repo', selectFolder: vi.fn(), setProjectPath: vi.fn() }),
  useSessions: () => ({ refreshSessionWorkspace: mocks.refreshSessionWorkspace }),
}))
vi.mock('@/features/settings/state', () => ({
  usePreferencesStore: (
    selector: (state: {
      settings: { selectedModel: ReturnType<typeof SupportedModelId> }
    }) => unknown,
  ) => selector({ settings: { selectedModel: SupportedModelId('openai/gpt-5') } }),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: { compactSession: mocks.compactSession } }))
vi.mock('@/shell/ui-store', () => {
  const state = {
    closeCommandSurface: mocks.close,
    openCommandSurface: vi.fn(),
    requestChatCommand: vi.fn(),
    setLastRightSidebarPanel: vi.fn(),
    openFeedbackModal: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleTerminal: vi.fn(),
    showToast: mocks.showToast,
  }
  return {
    useUIStore: (selector: (value: typeof state) => unknown) => selector(state),
  }
})

import { useGlobalCommandActions } from '../useGlobalCommandActions'

describe('useGlobalCommandActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.compactSession.mockResolvedValue({ compacted: true })
    mocks.refreshSession.mockResolvedValue(undefined)
    mocks.refreshSessionWorkspace.mockResolvedValue(undefined)
  })

  it('refreshes session detail and workspace after compacting', async () => {
    const { result } = renderHook(() => useGlobalCommandActions())

    await act(() => result.current.actions.compactSession())

    expect(mocks.compactSession).toHaveBeenCalledWith(
      SessionId('session-1'),
      SupportedModelId('openai/gpt-5'),
    )
    expect(mocks.refreshSession).toHaveBeenCalledWith(SessionId('session-1'))
    expect(mocks.refreshSessionWorkspace).toHaveBeenCalledWith(SessionId('session-1'))
    expect(mocks.showToast).toHaveBeenCalledWith('Session compacted.', 'success')
  })
})
