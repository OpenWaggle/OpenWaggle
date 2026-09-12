import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, render, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import type { LexicalEditor } from 'lexical'
import { createRef, type RefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBranchSummaryStore } from '@/features/chat/state'
import { LexicalComposerEditor } from '@/features/composer/components/LexicalComposerEditor'
import { setEditorText } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useScopedComposerDrafts } from '../useScopedComposerDrafts'

vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: '/workspace' }),
}))

const SESSION_ID = SessionId('visualization-session')
const BRANCH_ID = SessionBranchId('visualization-session:main')

function ComposerWithDelayedWorkspace({
  editorRef,
  sessionId = SESSION_ID,
}: {
  readonly editorRef: RefObject<LexicalEditor | null>
  readonly sessionId?: SessionId | null
}) {
  const draftReady = useScopedComposerDrafts(sessionId)
  return (
    <LexicalComposerEditor
      onSubmit={vi.fn()}
      placeholder="Ask"
      editorRef={editorRef}
      disabled={!draftReady}
      checkAndConvertPaste={vi.fn(() => false)}
    />
  )
}

function workspace(sessionId = SESSION_ID): SessionWorkspace {
  return fromPartial<SessionWorkspace>({
    tree: { session: { id: sessionId, projectPath: '/workspace' } },
    activeBranchId: SessionBranchId(`${sessionId}:main`),
    activeNodeId: null,
  })
}

describe('scoped composer draft hydration', () => {
  beforeEach(() => {
    Range.prototype.getBoundingClientRect = () => new DOMRect()
    useComposerStore.setState(useComposerStore.getInitialState())
    useSessionStore.setState({ activeWorkspace: null, draftBranch: null })
    useBranchSummaryStore.getState().clearPrompt()
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, projectPath: '/workspace' },
      isLoaded: true,
      loadError: null,
    })
  })

  it('blocks editing until the selected session draft is restored', async () => {
    const editorRef = createRef<LexicalEditor>()
    const contextKey = `project:/workspace:session:${SESSION_ID}:branch:${BRANCH_ID}`
    useComposerStore.getState().saveScopedDraft(contextKey, {
      input: 'Saved visualization prompt',
      attachments: [],
    })
    render(<ComposerWithDelayedWorkspace editorRef={editorRef} />)
    await waitFor(() => expect(editorRef.current).not.toBeNull())
    expect(editorRef.current?.isEditable()).toBe(false)
    expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveAttribute(
      'contenteditable',
      'false',
    )
    act(() => useSessionStore.getState().setActiveWorkspace(workspace()))
    await waitFor(() => expect(editorRef.current?.isEditable()).toBe(true))
    expect(useComposerStore.getState().input).toBe('Saved visualization prompt')
    expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveTextContent(
      'Saved visualization prompt',
    )
  })

  it('keeps the restored draft and new input when global project settings catch up', async () => {
    usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: null } })
    useSessionStore.getState().setActiveWorkspace(workspace())
    const editorRef = createRef<LexicalEditor>()
    render(<ComposerWithDelayedWorkspace editorRef={editorRef} />)
    await waitFor(() => expect(editorRef.current?.isEditable()).toBe(true))
    const editor = editorRef.current
    if (!editor) throw new Error('Expected composer editor')

    act(() => setEditorText(editor, '/vis'))
    await waitFor(() => expect(useComposerStore.getState().input).toBe('/vis'))

    act(() => {
      usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: '/workspace' } })
    })

    await waitFor(() =>
      expect(useComposerStore.getState().activeDraftContextKey).toBe(
        `project:/workspace:session:${SESSION_ID}:branch:${BRANCH_ID}`,
      ),
    )
    expect(useComposerStore.getState().input).toBe('/vis')
    expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveTextContent('/vis')
  })

  it('blocks a new session selection until its workspace arrives and preserves both drafts', async () => {
    const nextSessionId = SessionId('next-session')
    const nextContextKey = `project:/workspace:session:${nextSessionId}:branch:${nextSessionId}:main`
    useComposerStore.getState().saveScopedDraft(nextContextKey, {
      input: 'Other session draft',
      attachments: [],
    })
    useSessionStore.getState().setActiveWorkspace(workspace())
    const editorRef = createRef<LexicalEditor>()
    const { rerender } = render(<ComposerWithDelayedWorkspace editorRef={editorRef} />)
    await waitFor(() => expect(editorRef.current?.isEditable()).toBe(true))
    const editor = editorRef.current
    if (!editor) throw new Error('Expected composer editor')
    act(() => setEditorText(editor, 'First session draft'))
    await waitFor(() => expect(useComposerStore.getState().input).toBe('First session draft'))

    rerender(<ComposerWithDelayedWorkspace editorRef={editorRef} sessionId={nextSessionId} />)
    expect(editor.isEditable()).toBe(false)
    act(() => useSessionStore.getState().setActiveWorkspace(workspace(nextSessionId)))
    await waitFor(() => expect(editor.isEditable()).toBe(true))
    expect(useComposerStore.getState().input).toBe('Other session draft')

    rerender(<ComposerWithDelayedWorkspace editorRef={editorRef} />)
    expect(editor.isEditable()).toBe(false)
    act(() => useSessionStore.getState().setActiveWorkspace(workspace()))
    await waitFor(() => expect(editor.isEditable()).toBe(true))
    expect(useComposerStore.getState().input).toBe('First session draft')
  })

  it('keeps new-session drafts editable without a session workspace', async () => {
    const editorRef = createRef<LexicalEditor>()
    render(<ComposerWithDelayedWorkspace editorRef={editorRef} sessionId={null} />)
    await waitFor(() => expect(editorRef.current?.isEditable()).toBe(true))
    expect(useComposerStore.getState().activeDraftContextKey).toBe('project:/workspace:new-session')
  })
})
