import { MessageId, SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionNode, SessionTree, SessionWorkspace } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBranchSummaryStore, useChatStore } from '@/features/chat/state'
import { useScopedComposerDrafts } from '@/features/composer/hooks'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { node, treeUiState } from '../../lib/__tests__/session-tree-test-fixtures'
import { useSessionTreeNodeSelection } from '../useSessionTreeNodeSelection'

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  navigateSessionTree: vi.fn(),
  getPiBranchSummarySkipPrompt: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => m.navigate }))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getPiBranchSummarySkipPrompt: m.getPiBranchSummarySkipPrompt,
    navigateSessionTree: m.navigateSessionTree,
    discardPreparedAttachment: vi.fn(async () => {}),
  },
}))

const SESSION_ID = SessionId('session-1')
const ROOT = node({ id: 'root', depth: 0, order: 1 })
const USER: SessionNode = {
  ...node({ id: 'user', parentId: 'root', depth: 1, order: 2, kind: 'user_message' }),
  role: 'user',
  message: {
    id: MessageId('user'),
    role: 'user',
    parts: [{ type: 'text', text: 'Old prompt' }],
    createdAt: 2,
  },
}
const ASSISTANT = node({ id: 'assistant', parentId: 'user', depth: 2, order: 3 })
const OTHER = node({ id: 'other', parentId: 'root', depth: 1, order: 4 })

function tree(): SessionTree {
  return {
    session: { id: SESSION_ID, title: 't', projectPath: '/repo', createdAt: 1, updatedAt: 2 },
    nodes: [ROOT, USER, ASSISTANT, OTHER],
    branches: [],
    branchStates: [],
    uiState: treeUiState({ expandedNodeIds: ['root'], expandedNodeIdsTouched: true }),
  }
}
function workspace(activeNodeId = ASSISTANT.id): SessionWorkspace {
  return {
    tree: tree(),
    activeBranchId: SessionBranchId('main'),
    activeNodeId,
    transcriptPath: [
      { node: ROOT, isActive: true },
      { node: USER, isActive: true },
      { node: ASSISTANT, isActive: true },
    ],
  }
}
const DRAFT_KEY = 'project:/repo:session:session-1:draft:root'

/*
 * Selecting a node in the session tree while a custom branch summary is open keeps the message
 * written on the draft branch, never the summary's instructions in its place, and never replaces
 * a draft not sent yet on the branch it goes to.
 */
describe('Selecting again the draft branch shown, with a custom summary open', () => {
  beforeEach(() => {
    m.navigateSessionTree.mockResolvedValue({ cancelled: false })
    m.getPiBranchSummarySkipPrompt.mockResolvedValue(false)
    usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: '/repo' } })
    useBranchSummaryStore.getState().clearPrompt()
    useChatStore.setState({ activeSessionId: SESSION_ID, missingSessionIds: new Set() })
    useComposerStore.setState(useComposerStore.getInitialState())
    useSessionStore.setState({
      activeWorkspace: workspace(),
      draftBranch: null,
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('keeps the message, not the instructions', async () => {
    renderHook(() => useScopedComposerDrafts(useChatStore((s) => s.activeSessionId)))
    const { result, rerender } = renderHook(
      ({ ws }) =>
        useSessionTreeNodeSelection({
          activeWorkspace: ws,
          selectedModel: SupportedModelId('openai/gpt-5.5'),
          showToast: vi.fn(),
          tree: tree(),
        }),
      { initialProps: { ws: workspace() } },
    )
    // Branch from the user node: draft from root, prompt opens (choice).
    await act(async () => result.current.selectNode(USER))
    expect(useComposerStore.getState().activeDraftContextKey).toBe(DRAFT_KEY)
    expect(useBranchSummaryStore.getState().prompt?.mode).toBe('choice')
    act(() => useComposerStore.getState().setInput('My edited message'))
    // (choice disables editing in the UI; model the user editing before opening custom)
    useBranchSummaryStore.getState().startCustomPrompt('My edited message')
    act(() => useComposerStore.getState().setInput('Summarize only the API changes'))
    // Workspace refreshed to the route node, as the app does.
    act(() => useSessionStore.setState({ activeWorkspace: workspace(ROOT.id) }))
    rerender({ ws: workspace(ROOT.id) })

    // The user clicks the root node again in the tree (same draft source).
    await act(async () => result.current.selectNode(ROOT))

    const s = useComposerStore.getState()
    expect([s.input, s.getScopedDraft(DRAFT_KEY)?.input]).toContain('My edited message')
  })
})

describe('Leaving a draft branch from the tree for one with an older draft', () => {
  beforeEach(() => {
    m.navigateSessionTree.mockResolvedValue({ cancelled: false })
    m.getPiBranchSummarySkipPrompt.mockResolvedValue(false)
    usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: '/repo' } })
    useBranchSummaryStore.getState().clearPrompt()
    useChatStore.setState({ activeSessionId: SESSION_ID, missingSessionIds: new Set() })
    useComposerStore.setState(useComposerStore.getInitialState())
    useSessionStore.setState({
      activeWorkspace: workspace(),
      draftBranch: null,
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
    })
  })
  for (const target of ['draft', 'materialized'] as const) {
    it(`to a ${target} target`, async () => {
      renderHook(() => useScopedComposerDrafts(useChatStore((s) => s.activeSessionId)))
      act(() => useComposerStore.getState().setInput('Older on main'))
      const t = tree()
      const withBranch: SessionTree =
        target === 'materialized'
          ? {
              ...t,
              branches: [
                {
                  id: SessionBranchId('b1'),
                  sessionId: SESSION_ID,
                  sourceNodeId: ROOT.id,
                  headNodeId: OTHER.id,
                  name: 'b1',
                  isMain: false,
                  createdAt: 1,
                  updatedAt: 1,
                },
              ],
            }
          : t
      const targetKey =
        target === 'draft'
          ? 'project:/repo:session:session-1:draft:other'
          : 'project:/repo:session:session-1:branch:b1'
      useComposerStore
        .getState()
        .saveScopedDraft(targetKey, { input: 'Older on target', attachments: [] })
      const { result } = renderHook(() =>
        useSessionTreeNodeSelection({
          activeWorkspace: useSessionStore((s) => s.activeWorkspace),
          selectedModel: SupportedModelId('openai/gpt-5.5'),
          showToast: vi.fn(),
          tree: withBranch,
        }),
      )
      await act(async () => result.current.selectNode(USER))
      expect(useBranchSummaryStore.getState().prompt?.mode).toBe('choice')
      useBranchSummaryStore.getState().startCustomPrompt('Old prompt')
      act(() => useComposerStore.getState().setInput('Instructions'))
      await act(async () => result.current.selectNode(OTHER))
      if (target === 'materialized')
        act(() =>
          useSessionStore.setState({
            activeWorkspace: {
              ...workspace(OTHER.id),
              tree: withBranch,
              activeBranchId: SessionBranchId('b1'),
            },
          }),
        )
      const s = useComposerStore.getState()
      expect(s.activeDraftContextKey).toBe(targetKey)
      expect(s.input).toBe('Older on target')
      expect(s.getScopedDraft(DRAFT_KEY)?.input).toBe('Old prompt')
      expect(s.getScopedDraft('project:/repo:session:session-1:branch:main')?.input).toBe(
        'Older on main',
      )
    })
  }
})
