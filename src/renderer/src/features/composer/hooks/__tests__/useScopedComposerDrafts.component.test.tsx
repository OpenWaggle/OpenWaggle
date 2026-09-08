import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, render, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import type { LexicalEditor } from 'lexical'
import { createRef, type RefObject } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBranchSummaryStore } from '@/features/chat/state'
import { LexicalComposerEditor } from '@/features/composer/components/LexicalComposerEditor'
import { setEditorText } from '@/features/composer/lib'
import { buildComposerDraftContextKey } from '@/features/composer/lib/composer-draft-context'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useScopedComposerDrafts } from '../useScopedComposerDrafts'

vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: null }),
}))

function workspace(sessionId: SessionId, branch = 'main'): SessionWorkspace {
  return fromPartial<SessionWorkspace>({
    tree: { session: { id: sessionId } },
    activeBranchId: SessionBranchId(`${sessionId}:${branch}`),
    activeNodeId: null,
  })
}

function Harness({
  sessionId,
  editorRef,
}: {
  readonly sessionId: SessionId | null
  readonly editorRef: RefObject<LexicalEditor | null>
}) {
  const ready = useScopedComposerDrafts(sessionId)
  return (
    <LexicalComposerEditor
      editorRef={editorRef}
      disabled={!ready}
      onSubmit={vi.fn()}
      placeholder="Ask"
      checkAndConvertPaste={vi.fn(() => false)}
    />
  )
}

function saveDraft(sessionId: SessionId, branch: string, input: string) {
  useComposerStore.getState().saveScopedDraft(
    buildComposerDraftContextKey({
      projectPath: null,
      sessionId,
      activeBranchId: SessionBranchId(`${sessionId}:${branch}`),
    }),
    { input, attachments: [] },
  )
}

describe('useScopedComposerDrafts workspace hydration', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })

  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useSessionStore.setState(useSessionStore.getInitialState())
    useBranchSummaryStore.setState(useBranchSummaryStore.getInitialState())
    usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: null } })
  })

  it('waits for the workspace before accepting edits and preserves them across refreshes', async () => {
    const editorRef = createRef<LexicalEditor>()
    const sessionId = SessionId('session-a')
    render(<Harness sessionId={sessionId} editorRef={editorRef} />)
    await waitFor(() => expect(editorRef.current).not.toBeNull())
    const editor = editorRef.current
    if (!editor) throw new Error('Expected an editor.')
    expect(editor.isEditable()).toBe(false)
    await act(async () => useSessionStore.setState({ activeWorkspace: workspace(sessionId) }))
    await waitFor(() => expect(editor.isEditable()).toBe(true))
    act(() => setEditorText(editor, 'also check whether any are already fixed on main'))
    await waitFor(() =>
      expect(useComposerStore.getState().input).toBe(
        'also check whether any are already fixed on main',
      ),
    )
    await act(async () => useSessionStore.setState({ activeWorkspace: workspace(sessionId) }))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveTextContent(
        'also check whether any are already fixed on main',
      ),
    )
  })

  it('enables the fresh no-session composer without waiting for a workspace', async () => {
    const editorRef = createRef<LexicalEditor>()
    render(<Harness sessionId={null} editorRef={editorRef} />)
    await waitFor(() => expect(editorRef.current?.isEditable()).toBe(true))
    expect(useComposerStore.getState().activeDraftContextKey).toBe('project:no-project:new-session')
  })

  it('restores the intended branch draft before enabling a newly selected session', async () => {
    const editorRef = createRef<LexicalEditor>()
    const firstSession = SessionId('session-a')
    const nextSession = SessionId('session-b')
    saveDraft(firstSession, 'main', 'first session draft')
    saveDraft(nextSession, 'review', 'second session review draft')
    useSessionStore.setState({ activeWorkspace: workspace(firstSession) })
    const { rerender } = render(<Harness sessionId={firstSession} editorRef={editorRef} />)
    await waitFor(() => {
      expect(editorRef.current?.isEditable()).toBe(true)
      expect(screen.getByRole('textbox')).toHaveTextContent('first session draft')
    })

    rerender(<Harness sessionId={nextSession} editorRef={editorRef} />)
    expect(editorRef.current?.isEditable()).toBe(false)
    await act(async () =>
      useSessionStore.setState({ activeWorkspace: workspace(nextSession, 'review') }),
    )
    await waitFor(() => {
      expect(editorRef.current?.isEditable()).toBe(true)
      expect(screen.getByRole('textbox')).toHaveTextContent('second session review draft')
    })

    await act(async () => useSessionStore.setState({ activeWorkspace: workspace(nextSession) }))
    await waitFor(() => {
      expect(editorRef.current?.isEditable()).toBe(true)
      expect(screen.getByRole('textbox').textContent).toBe('')
    })
  })
})
