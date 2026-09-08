import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useBranchSummaryStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { buildComposerDraftContextKey } from '../../lib/composer-draft-context'
import { useComposerStore } from '../../state/composer-store'
import { useScopedComposerDrafts } from '../useScopedComposerDrafts'

const SESSION_A = SessionId('session-a')

function workspace(sessionId = SESSION_A, branchId = SessionBranchId('main')): SessionWorkspace {
  return {
    tree: {
      session: {
        id: sessionId,
        title: 'Draft ownership',
        projectPath: '/repo',
        createdAt: 1,
        updatedAt: 2,
      },
      nodes: [],
      branches: [],
      branchStates: [],
      uiState: {
        sessionId,
        expandedNodeIds: [],
        expandedNodeIdsTouched: false,
        branchesSidebarCollapsed: false,
        updatedAt: 1,
      },
    },
    activeBranchId: branchId,
    activeNodeId: null,
    transcriptPath: [],
  }
}

describe('useScopedComposerDrafts', () => {
  beforeEach(() => {
    useBranchSummaryStore.getState().clearPrompt()
    usePreferencesStore.setState((state) => ({
      settings: { ...state.settings, projectPath: '/repo' },
    }))
    useSessionStore.setState({ activeWorkspace: null, draftBranch: null })
    useComposerStore.setState({
      activeDraftContextKey: null,
      scopedDrafts: {},
      input: '',
      attachments: [],
      selectedWagglePreset: null,
      lexicalEditor: null,
    })
  })

  it('preserves a draft typed before the opened session workspace arrives', () => {
    renderHook(() => useScopedComposerDrafts(SESSION_A))
    act(() => useComposerStore.getState().setInput('Keep this prompt'))
    act(() => useSessionStore.setState({ activeWorkspace: workspace() }))
    expect(useComposerStore.getState().input).toBe('Keep this prompt')
    expect(useComposerStore.getState().activeDraftContextKey).toBe(
      buildComposerDraftContextKey({
        projectPath: '/repo',
        sessionId: SESSION_A,
        activeBranchId: SessionBranchId('main'),
      }),
    )
  })

  it('keeps pending drafts isolated during rapid session switching and ignores stale workspaces', () => {
    const sessionB = SessionId('session-b')
    const { rerender } = renderHook(({ sessionId }) => useScopedComposerDrafts(sessionId), {
      initialProps: { sessionId: SESSION_A },
    })
    act(() => useComposerStore.getState().setInput('Draft A'))
    rerender({ sessionId: sessionB })
    expect(useComposerStore.getState().input).toBe('')
    act(() => useComposerStore.getState().setInput('Draft B'))
    act(() => useSessionStore.setState({ activeWorkspace: workspace() }))
    expect(useComposerStore.getState().input).toBe('Draft B')
    act(() => useSessionStore.setState({ activeWorkspace: workspace(sessionB) }))
    expect(useComposerStore.getState().input).toBe('Draft B')
    rerender({ sessionId: SESSION_A })
    expect(useComposerStore.getState().input).toBe('Draft A')
    act(() => useSessionStore.setState({ activeWorkspace: workspace() }))
    expect(useComposerStore.getState().input).toBe('Draft A')
    rerender({ sessionId: sessionB })
    act(() => useSessionStore.setState({ activeWorkspace: workspace(sessionB) }))
    expect(useComposerStore.getState().input).toBe('Draft B')
  })

  it('restores the saved branch draft when nothing was entered during hydration', () => {
    const contextKey = buildComposerDraftContextKey({
      projectPath: '/repo',
      sessionId: SESSION_A,
      activeBranchId: SessionBranchId('main'),
    })
    useComposerStore
      .getState()
      .saveScopedDraft(contextKey, { input: 'Saved branch draft', attachments: [] })
    renderHook(() => useScopedComposerDrafts(SESSION_A))
    act(() => useSessionStore.setState({ activeWorkspace: workspace() }))
    expect(useComposerStore.getState().input).toBe('Saved branch draft')
    act(() =>
      useSessionStore.setState({
        activeWorkspace: workspace(SESSION_A, SessionBranchId('alternative')),
      }),
    )
    expect(useComposerStore.getState().input).toBe('')
    act(() => useSessionStore.setState({ activeWorkspace: workspace() }))
    expect(useComposerStore.getState().input).toBe('Saved branch draft')
  })

  it('preserves attachment-only drafts across hydration', () => {
    const attachment = {
      id: 'attachment',
      kind: 'text' as const,
      name: 'notes.txt',
      path: '/repo/notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      extractedText: 'Notes',
    }
    renderHook(() => useScopedComposerDrafts(SESSION_A))
    act(() => useComposerStore.getState().addAttachments([attachment]))
    act(() => useSessionStore.setState({ activeWorkspace: workspace() }))
    expect(useComposerStore.getState().attachments).toEqual([attachment])
  })
})
