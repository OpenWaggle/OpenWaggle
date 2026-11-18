import { SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionSummary } from '@shared/types/session'
import { renderHook } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useResourceProject } from '../useResourceProject'

const PROJECT_A = '/projects/a'
const PROJECT_B = '/projects/b'
const SESSION_B = SessionId('session-b')
const initialChat = useChatStore.getState()
const initialSessions = useSessionStore.getState()
const initialPreferences = usePreferencesStore.getState()

beforeEach(() => {
  // The preference still names the previous project: its Host write lagged or was refused.
  usePreferencesStore.setState({
    settings: {
      ...usePreferencesStore.getState().settings,
      projectPath: PROJECT_A,
      recentProjects: ['/projects/old', PROJECT_A, PROJECT_B],
    },
  })
})

afterEach(() => {
  useChatStore.setState(initialChat, true)
  useSessionStore.setState(initialSessions, true)
  usePreferencesStore.setState(initialPreferences, true)
})

function selectSession(input: { readonly detail: boolean; readonly summary: boolean }) {
  useChatStore.setState({
    activeSessionId: SESSION_B,
    activeSession: input.detail
      ? fromPartial<SessionDetail>({ id: SESSION_B, projectPath: PROJECT_B })
      : null,
    draftSession: null,
  })
  useSessionStore.setState({
    sessions: input.summary
      ? [fromPartial<SessionSummary>({ id: SESSION_B, projectPath: PROJECT_B })]
      : [],
  })
}

describe('useResourceProject default', () => {
  it("defaults Settings browsers to the open Session's project", () => {
    selectSession({ detail: true, summary: true })
    expect(renderHook(() => useResourceProject()).result.current.projectPath).toBe(PROJECT_B)
  })

  it('falls back to the preference, not an older recent project, while the Session is unknown', () => {
    selectSession({ detail: false, summary: false })
    expect(renderHook(() => useResourceProject()).result.current.projectPath).toBe(PROJECT_A)
  })
})
