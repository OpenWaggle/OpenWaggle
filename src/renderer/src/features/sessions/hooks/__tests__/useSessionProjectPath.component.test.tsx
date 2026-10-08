import { SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionSummary } from '@shared/types/session'
import { renderHook } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state/session-store'
import { useResourceProject } from '@/features/settings'
import { usePreferencesStore } from '@/features/settings/state'
import { useSessionProjectPath } from '../useSessionProjectPath'

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

describe('useSessionProjectPath', () => {
  it("follows the open Session's project, not the stale preference", () => {
    selectSession({ detail: true, summary: true })
    expect(renderHook(() => useSessionProjectPath()).result.current).toBe(PROJECT_B)
  })

  it("uses the Session's catalog summary while its detail is still loading", () => {
    selectSession({ detail: false, summary: true })
    expect(renderHook(() => useSessionProjectPath()).result.current).toBe(PROJECT_B)
  })

  it('names no project while the selected Session is unknown', () => {
    selectSession({ detail: false, summary: false })
    expect(renderHook(() => useSessionProjectPath()).result.current).toBeNull()
  })

  it('uses the preference without a Session, like a draft composer', () => {
    useChatStore.setState({
      activeSessionId: null,
      activeSession: null,
      draftSession: { projectPath: PROJECT_B },
    })
    expect(renderHook(() => useSessionProjectPath()).result.current).toBe(PROJECT_A)
  })
})

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
