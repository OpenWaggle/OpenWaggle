import { SessionBranchId, SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail, SessionWorkspace } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, renderHook } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useScopedComposerDrafts } from '@/features/composer/hooks'
import { useComposerStore } from '@/features/composer/state'
import { useGitStore } from '@/features/git/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { useChatRouteEffects } from '../-chat-route-effects'

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    updateSessionTreeUiState: vi.fn().mockResolvedValue(undefined),
    getGitStatus: vi.fn(() => new Promise(() => {})),
    listGitBranches: vi.fn(() => new Promise(() => {})),
    getSessionDetail: vi.fn(),
    getSessionTree: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
    deleteSession: vi.fn(),
    unregisterBrowserPreviewOwner: vi.fn().mockResolvedValue(undefined),
  },
}))

const ID = SessionId('removed-session')
const BRANCH = SessionBranchId('removed-session:main')
const NODE = SessionNodeId('n1')
const session: SessionDetail = {
  id: ID,
  title: 't',
  projectPath: '/old-project',
  messages: [],
  createdAt: 1,
  updatedAt: 2,
}

/*
 * A refused send to a discovered Session whose Pi file was deleted gives its text back to the
 * composer; the Host then removes the Session and the view goes to New session. The text goes
 * with it there, through the real composer drafts and route effects.
 */
describe('An open Session the Host removed', () => {
  it('leaves its draft in New session', async () => {
    usePreferencesStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        selectedModel: SupportedModelId('openai/gpt-5.5'),
        projectPath: '/old-project',
      },
      setProjectPath: vi.fn().mockResolvedValue(undefined),
    })
    useGitStore.setState({
      refreshStatus: vi.fn().mockResolvedValue(undefined),
      refreshBranches: vi.fn().mockResolvedValue(undefined),
    })
    useSessionStore.setState({
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
      refreshSessionTree: vi.fn().mockResolvedValue(undefined),
      loadSessions: vi.fn().mockResolvedValue(undefined),
      draftBranch: null,
      activeWorkspace: fromPartial<SessionWorkspace>({
        tree: {
          session: {
            id: ID,
            title: 't',
            projectPath: '/old-project',
            createdAt: 1,
            updatedAt: 2,
            lastActiveNodeId: NODE,
            lastActiveBranchId: BRANCH,
          },
          nodes: [],
          branches: [],
          branchStates: [],
          uiState: null,
        },
        activeBranchId: BRANCH,
        activeNodeId: NODE,
        transcriptPath: [],
      }),
    })
    useChatStore.setState({
      activeSessionId: ID,
      activeSession: session,
      sessionById: new Map([[ID, session]]),
      missingSessionIds: new Set(),
    })
    renderHook(() => {
      const activeSessionId = useChatStore((s) => s.activeSessionId)
      useScopedComposerDrafts(activeSessionId)
      useChatRouteEffects({ branchId: null, diffOpen: false, nodeId: null, sessionId: String(ID) })
    })
    act(() => useComposerStore.getState().setInput('Are you there?'))
    vi.mocked(api.getSessionDetail).mockResolvedValue(null)
    await act(async () => {
      await useChatStore.getState().refreshSession(ID)
    })
    expect(useComposerStore.getState().input).toBe('Are you there?')
    expect(useComposerStore.getState().activeDraftContextKey).toBe(
      'project:/old-project:new-session',
    )
    // Asked again, the Session is still gone: the draft is not carried twice.
    await act(async () => {
      await useChatStore.getState().refreshSession(ID)
    })
    expect(useComposerStore.getState().input).toBe('Are you there?')
  })

  it('does not carry the draft of a Session the user deleted', async () => {
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, projectPath: '/old-project' },
    })
    useChatStore.setState({
      activeSessionId: ID,
      activeSession: session,
      sessionById: new Map([[ID, session]]),
      missingSessionIds: new Set(),
    })
    useComposerStore.setState(useComposerStore.getInitialState())
    renderHook(() => {
      const activeSessionId = useChatStore((s) => s.activeSessionId)
      useScopedComposerDrafts(activeSessionId)
    })
    act(() => useComposerStore.getState().setInput('Never mind'))
    vi.mocked(api.deleteSession).mockResolvedValue(undefined)

    await act(async () => {
      await useChatStore.getState().deleteSession(ID)
    })

    expect(
      useComposerStore.getState().getScopedDraft('project:/old-project:new-session'),
    ).toBeNull()
  })
})
