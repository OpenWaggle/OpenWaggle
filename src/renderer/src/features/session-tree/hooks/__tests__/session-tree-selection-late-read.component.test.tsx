import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBranchSummaryStore } from '@/features/chat/state'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { useSessionTreeNodeSelection } from '../useSessionTreeNodeSelection'
import {
  ASSISTANT_NODE,
  ROOT_NODE,
  SESSION_ID,
  tree,
  USER_NODE,
  workspace,
} from './session-tree-selection-fixtures'

const selectionMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  navigateSessionTree: vi.fn(),
  getPiBranchSummarySkipPrompt: vi.fn(),
  getSessionWorkspace: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => selectionMocks.navigate,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getPiBranchSummarySkipPrompt: selectionMocks.getPiBranchSummarySkipPrompt,
    navigateSessionTree: selectionMocks.navigateSessionTree,
    getSessionWorkspace: selectionMocks.getSessionWorkspace,
  },
}))

/*
 * Drafting a branch from a content-free user node reads its text from the Host first (B5). The
 * answer may come after the user moved on: it must then draft nothing, or it switches the composer
 * and navigates back to the Session the user left.
 */
describe('a late read of a content-free user node (PR 391 review R2 P2-2)', () => {
  beforeEach(() => {
    selectionMocks.navigate.mockClear()
    selectionMocks.getSessionWorkspace.mockReset()
    selectionMocks.navigateSessionTree.mockReset().mockResolvedValue({ cancelled: false })
    selectionMocks.getPiBranchSummarySkipPrompt.mockReset().mockResolvedValue(true)
    useBranchSummaryStore.getState().clearPrompt()
    useComposerStore.setState({ input: 'previous text', attachments: [], lexicalEditor: null })
    useSessionStore.setState({
      activeWorkspace: workspace(),
      draftBranch: null,
      clearDraftBranchForSession: vi.fn(),
    })
  })

  function contentFreeUserNode() {
    const { message: _message, contentJson: _content, metadataJson: _metadata, ...bare } = USER_NODE
    return { ...bare, hasMessage: true, preview: 'Use this' }
  }

  function deferredWorkspaceRead() {
    let resolve: (value: SessionWorkspace) => void = () => {}
    selectionMocks.getSessionWorkspace.mockReturnValueOnce(
      new Promise<SessionWorkspace>((settle) => {
        resolve = settle
      }),
    )
    return () => resolve({ ...workspace(), transcriptPath: [{ node: USER_NODE, isActive: true }] })
  }

  function renderSelection() {
    const setDraftBranch = vi.fn((draftBranch) => useSessionStore.setState({ draftBranch }))
    const refreshSessionWorkspace = vi.fn().mockResolvedValue(undefined)
    useSessionStore.setState({ setDraftBranch, refreshSessionWorkspace })
    useComposerStore.setState({ activeDraftContextKey: null, scopedDrafts: {} })
    const hook = renderHook(() =>
      useSessionTreeNodeSelection({
        activeWorkspace: workspace(),
        selectedModel: SupportedModelId('openai/gpt-5.5'),
        showToast: vi.fn(),
        tree: tree(),
      }),
    )
    return { ...hook, setDraftBranch }
  }

  async function expectNothingDrafted(setDraftBranch: ReturnType<typeof vi.fn>) {
    // Let the read's answer run.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(setDraftBranch).not.toHaveBeenCalled()
    expect(useComposerStore.getState().input).toBe('previous text')
    expect(selectionMocks.navigate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        params: { sessionId: 'session-1' },
        search: expect.any(Function),
      }),
    )
  }

  it('drafts nothing once another node was selected', async () => {
    const answer = deferredWorkspaceRead()
    const { result, setDraftBranch } = renderSelection()

    act(() => result.current.selectNode(contentFreeUserNode()))
    act(() => result.current.selectNode(ASSISTANT_NODE))
    selectionMocks.navigate.mockClear()
    answer()

    await expectNothingDrafted(setDraftBranch)
  })

  it('drafts nothing once the user left the Session', async () => {
    const answer = deferredWorkspaceRead()
    const { result, setDraftBranch } = renderSelection()

    act(() => result.current.selectNode(contentFreeUserNode()))
    const other = workspace()
    useSessionStore.setState({
      activeWorkspace: {
        ...other,
        tree: { ...other.tree, session: { ...other.tree.session, id: SessionId('session-2') } },
      },
    })
    answer()

    await expectNothingDrafted(setDraftBranch)
  })

  it('drafts nothing once the tree closed', async () => {
    const answer = deferredWorkspaceRead()
    const { result, setDraftBranch, unmount } = renderSelection()

    act(() => result.current.selectNode(contentFreeUserNode()))
    unmount()
    answer()

    await expectNothingDrafted(setDraftBranch)
  })

  it('still drafts when the read answers with nothing selected since', async () => {
    const answer = deferredWorkspaceRead()
    const { result, setDraftBranch } = renderSelection()

    act(() => result.current.selectNode(contentFreeUserNode()))
    answer()

    await waitFor(() => expect(useComposerStore.getState().input).toBe('Use this prompt'))
    expect(setDraftBranch).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      sourceNodeId: ROOT_NODE.id,
    })
  })
})
