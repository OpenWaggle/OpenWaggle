import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { LexicalEditor } from 'lexical'
import { createRef, type RefObject } from 'react'
import { beforeEach, expect, it } from 'vitest'
import { useBranchSummaryStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state'
import { WaggleMentionNode } from '../../components/nodes/WaggleMentionNode'
import { EditorRefPlugin } from '../../components/plugins/EditorRefPlugin'
import { SyncPlugin } from '../../components/plugins/SyncPlugin'
import { buildComposerDraftContextKey } from '../../lib/composer-draft-context'
import { setEditorText } from '../../lib/lexical-utils'
import { useComposerStore } from '../../state/composer-store'
import { useScopedComposerDrafts } from '../useScopedComposerDrafts'

const SESSION_ID = SessionId('pending-editor-session')
const workspace: SessionWorkspace = {
  tree: {
    session: { id: SESSION_ID, title: 'Draft', projectPath: '/repo', createdAt: 1, updatedAt: 2 },
    nodes: [],
    branches: [],
    branchStates: [],
    uiState: {
      sessionId: SESSION_ID,
      expandedNodeIds: [],
      expandedNodeIdsTouched: false,
      branchesSidebarCollapsed: false,
      updatedAt: 1,
    },
  },
  activeBranchId: SessionBranchId('main'),
  activeNodeId: null,
  transcriptPath: [],
}

function ScopedEditor({
  editorRef,
  sessionId = SESSION_ID,
}: {
  readonly editorRef: RefObject<LexicalEditor | null>
  readonly sessionId?: SessionId
}) {
  useScopedComposerDrafts(sessionId)
  return (
    <LexicalComposer
      initialConfig={{
        namespace: 'pending-draft-test',
        nodes: [WaggleMentionNode],
        onError: (error) => {
          throw error
        },
      }}
    >
      <PlainTextPlugin
        contentEditable={<ContentEditable aria-label="Draft" />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <SyncPlugin />
      <EditorRefPlugin editorRef={editorRef} />
    </LexicalComposer>
  )
}

beforeEach(() => {
  useBranchSummaryStore.getState().clearPrompt()
  useComposerStore.setState(useComposerStore.getInitialState())
  useSessionStore.setState({ activeWorkspace: null, draftBranch: null })
})

it('preserves an editor update still pending when the workspace hydrates', async () => {
  const editorRef = createRef<LexicalEditor>()
  render(<ScopedEditor editorRef={editorRef} />)
  await waitFor(() => expect(editorRef.current).not.toBeNull())
  const editor = editorRef.current
  if (!editor) throw new Error('Editor is missing')
  act(() => {
    setEditorText(editor, '/vis')
    useSessionStore.setState({ activeWorkspace: workspace })
  })
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveTextContent('/vis'),
  )
  expect(useComposerStore.getState().input).toBe('/vis')
})

it('commits a pending clear instead of resurrecting a saved branch draft', async () => {
  const editorRef = createRef<LexicalEditor>()
  const contextKey = buildComposerDraftContextKey({
    projectPath: '/repo',
    sessionId: SESSION_ID,
    activeBranchId: workspace.activeBranchId,
  })
  useComposerStore
    .getState()
    .saveScopedDraft(contextKey, { input: 'Old saved draft', attachments: [] })
  render(<ScopedEditor editorRef={editorRef} />)
  await waitFor(() => expect(editorRef.current).not.toBeNull())
  const editor = editorRef.current
  if (!editor) throw new Error('Editor is missing')
  act(() => setEditorText(editor, 'Temporary edit'))
  await waitFor(() => expect(useComposerStore.getState().input).toBe('Temporary edit'))
  act(() => {
    setEditorText(editor, '')
    useSessionStore.setState({ activeWorkspace: workspace })
  })
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveTextContent(/^$/),
  )
  expect(useComposerStore.getState().input).toBe('')
})

it('saves the outgoing pending edit without leaking it into another session', async () => {
  const editorRef = createRef<LexicalEditor>()
  const { rerender } = render(<ScopedEditor editorRef={editorRef} />)
  await waitFor(() => expect(editorRef.current).not.toBeNull())
  const editor = editorRef.current
  if (!editor) throw new Error('Editor is missing')
  act(() => {
    setEditorText(editor, 'Session A draft')
    rerender(<ScopedEditor editorRef={editorRef} sessionId={SessionId('session-b')} />)
  })
  await waitFor(() => expect(useComposerStore.getState().input).toBe(''))
  rerender(<ScopedEditor editorRef={editorRef} />)
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveTextContent('Session A draft'),
  )
})
