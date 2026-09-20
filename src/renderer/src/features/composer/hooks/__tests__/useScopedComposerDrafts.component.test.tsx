import { SessionBranchId, SessionId, WagglePresetId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { WAGGLE_INHERIT_MODEL } from '@shared/types/waggle'
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
      editedPendingDrafts: {},
      input: '',
      attachments: [],
      selectedWagglePreset: null,
      lexicalEditor: null,
    })
  })

  it('does not resurrect a saved draft after the pending draft was edited and cleared', () => {
    const contextKey = buildComposerDraftContextKey({
      projectPath: '/repo',
      sessionId: SESSION_A,
      activeBranchId: SessionBranchId('main'),
    })
    useComposerStore
      .getState()
      .saveScopedDraft(contextKey, { input: 'Old saved draft', attachments: [] })
    renderHook(() => useScopedComposerDrafts(SESSION_A))
    act(() => useComposerStore.getState().setInput('Temporary edit'))
    act(() => useComposerStore.getState().setInput(''))
    act(() => useSessionStore.setState({ activeWorkspace: workspace() }))
    expect(useComposerStore.getState().input).toBe('')
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

  it('keeps a cleared attachment draft empty when hydration restores the branch', () => {
    const contextKey = buildComposerDraftContextKey({
      projectPath: '/repo',
      sessionId: SESSION_A,
      activeBranchId: SessionBranchId('main'),
    })
    useComposerStore
      .getState()
      .saveScopedDraft(contextKey, { input: 'Old saved draft', attachments: [] })
    renderHook(() => useScopedComposerDrafts(SESSION_A))
    act(() =>
      useComposerStore.getState().addAttachments([
        {
          id: 'note',
          kind: 'text',
          name: 'note.txt',
          path: '/repo/note.txt',
          mimeType: 'text/plain',
          sizeBytes: 1,
          extractedText: 'a',
        },
      ]),
    )
    act(() => useComposerStore.getState().removeAttachment('note'))
    act(() => useSessionStore.setState({ activeWorkspace: workspace() }))
    expect(useComposerStore.getState().input).toBe('')
    expect(useComposerStore.getState().attachments).toEqual([])
  })

  it('does not restore a saved draft after removing a pending Waggle preset', () => {
    const contextKey = buildComposerDraftContextKey({
      projectPath: '/repo',
      sessionId: SESSION_A,
      activeBranchId: SessionBranchId('main'),
    })
    useComposerStore
      .getState()
      .saveScopedDraft(contextKey, { input: 'Old saved draft', attachments: [] })
    renderHook(() => useScopedComposerDrafts(SESSION_A))
    act(() =>
      useComposerStore.getState().setSelectedWagglePreset({
        id: WagglePresetId('review'),
        name: 'Review',
        description: 'Review changes',
        config: {
          mode: 'sequential',
          agents: [
            {
              label: 'Architect',
              model: WAGGLE_INHERIT_MODEL,
              roleDescription: 'Review architecture',
              color: 'blue',
            },
            {
              label: 'Reviewer',
              model: WAGGLE_INHERIT_MODEL,
              roleDescription: 'Review implementation',
              color: 'amber',
            },
          ],
          stop: { primary: 'consensus', maxTurnsSafety: 4 },
        },
        isBuiltIn: false,
        createdAt: 1,
        updatedAt: 1,
      }),
    )
    act(() => useComposerStore.getState().setSelectedWagglePreset(null))
    act(() => useSessionStore.setState({ activeWorkspace: workspace() }))
    expect(useComposerStore.getState().input).toBe('')
    expect(useComposerStore.getState().selectedWagglePreset).toBeNull()
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

  it.each(['', 'Keep the pending edit'])(
    'restores the edited pending draft after unmounting and background hydration: %j',
    (pendingInput) => {
      const contextKey = buildComposerDraftContextKey({
        projectPath: '/repo',
        sessionId: SESSION_A,
        activeBranchId: SessionBranchId('main'),
      })
      useComposerStore
        .getState()
        .saveScopedDraft(contextKey, { input: 'Old saved draft', attachments: [] })
      const hook = renderHook(() => useScopedComposerDrafts(SESSION_A))
      act(() => useComposerStore.getState().setInput('Temporary edit'))
      act(() => useComposerStore.getState().setInput(pendingInput))
      hook.unmount()
      const other = renderHook(() => useScopedComposerDrafts(SessionId('session-b')))
      act(() => useComposerStore.getState().setInput('Session B draft'))
      act(() => useSessionStore.setState({ activeWorkspace: workspace() }))
      other.unmount()
      renderHook(() => useScopedComposerDrafts(SESSION_A))
      expect(useComposerStore.getState().input).toBe(pendingInput)
      expect(useComposerStore.getState().getScopedDraft(contextKey)?.input ?? '').toBe(pendingInput)
    },
  )

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
    act(() => {
      useComposerStore.getState().setInput('')
      useComposerStore.getState().replaceAttachments([])
      useComposerStore.getState().setSelectedWagglePreset(null)
    })
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

  it.each([true, false])(
    'preserves typing across delayed project selection, workspace first: %s',
    (workspaceFirst) => {
      usePreferencesStore.setState((state) => ({
        settings: { ...state.settings, projectPath: '/old-project' },
      }))
      renderHook(() => useScopedComposerDrafts(SESSION_A))
      act(() => useComposerStore.getState().setInput('New project draft'))
      const hydrateWorkspace = () =>
        act(() => useSessionStore.setState({ activeWorkspace: workspace() }))
      const updateProject = () =>
        act(() =>
          usePreferencesStore.setState((state) => ({
            settings: { ...state.settings, projectPath: '/repo' },
          })),
        )
      if (workspaceFirst) {
        hydrateWorkspace()
        updateProject()
      } else {
        updateProject()
        hydrateWorkspace()
      }
      expect(useComposerStore.getState().input).toBe('New project draft')
      expect(useComposerStore.getState().activeDraftContextKey).toBe(
        buildComposerDraftContextKey({
          projectPath: '/repo',
          sessionId: SESSION_A,
          activeBranchId: SessionBranchId('main'),
        }),
      )
    },
  )
})
