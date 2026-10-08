import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { renderHook } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/features/git/hooks', () => ({
  useGit: () => ({ refreshStatus: vi.fn(), refreshBranches: vi.fn() }),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: {} }))

import { useChatPanelEnvironment } from '../useChatPanelEnvironment'

const PROJECT_A = '/projects/a'
const PROJECT_B = '/projects/b'
const initialChat = useChatStore.getState()
const initialPreferences = usePreferencesStore.getState()

function preferProject(projectPath: string) {
  usePreferencesStore.setState({
    settings: { ...usePreferencesStore.getState().settings, projectPath },
  })
}

afterEach(() => {
  useChatStore.setState(initialChat, true)
  usePreferencesStore.setState(initialPreferences, true)
})

describe('useChatPanelEnvironment project', () => {
  it('creates a draft Session in the project the draft was started in, not the stale preference', () => {
    // Starting a draft for B is synchronous; the preference follows only after a Host write.
    preferProject(PROJECT_A)
    useChatStore.setState({
      activeSessionId: null,
      activeSession: null,
      draftSession: { projectPath: PROJECT_B },
    })

    const { result } = renderHook(() => useChatPanelEnvironment())

    expect(result.current.projectPath).toBe(PROJECT_B)
  })

  it('uses the preference for a draft without a project', () => {
    preferProject(PROJECT_A)
    useChatStore.setState({
      activeSessionId: null,
      activeSession: null,
      draftSession: { projectPath: null },
    })

    const { result } = renderHook(() => useChatPanelEnvironment())

    expect(result.current.projectPath).toBe(PROJECT_A)
  })

  it('keeps the preference for an open Session', () => {
    preferProject(PROJECT_A)
    useChatStore.setState({
      activeSessionId: SessionId('session-a'),
      activeSession: fromPartial<SessionDetail>({
        id: SessionId('session-a'),
        projectPath: PROJECT_A,
      }),
      draftSession: null,
    })

    const { result } = renderHook(() => useChatPanelEnvironment())

    expect(result.current.projectPath).toBe(PROJECT_A)
  })
})
