import { SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { ChatPanelContent } from '../ChatPanel'
import { createSections } from './ChatPanel.test-utils'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    activateSessionResourceOwner: vi.fn(),
    getGitStatus: vi.fn().mockResolvedValue(null),
    listGitBranches: vi.fn().mockResolvedValue({ currentBranch: 'main', branches: [] }),
    listChangeRequests: vi.fn().mockResolvedValue({ ok: true, changeRequests: [] }),
    onGitWorkingTreeChanged: vi.fn(() => () => undefined),
    onWaggleEvent: vi.fn(() => () => undefined),
    onWaggleTurnEvent: vi.fn(() => () => undefined),
  },
}))

it('owns an editable pending draft and restores the untouched saved branch draft after hydration', async () => {
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  useComposerStore.setState(useComposerStore.getInitialState())
  useSessionStore.setState({ activeWorkspace: null, draftBranch: null })
  usePreferencesStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      projectPath: '/test/project',
      selectedModel: SupportedModelId('openai/gpt-5'),
    },
    isLoaded: true,
  })
  const sections = createSections()
  const sessionId = SessionId('session-1')
  const branchId = SessionBranchId('session-1:main')
  useComposerStore
    .getState()
    .saveScopedDraft(`project:/test/project:session:${sessionId}:branch:${branchId}`, {
      input: 'Saved prompt',
      attachments: [],
    })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ChatPanelContent sections={sections} />
    </QueryClientProvider>,
  )
  const input = screen.getByRole('textbox', { name: 'Message input' })
  expect(input).toHaveAttribute('contenteditable', 'true')
  expect(useComposerStore.getState().activeDraftContextKey).toBe(`session:${sessionId}:pending`)
  expect(input).toHaveTextContent('')
  expect(screen.queryByText('Loading session draft…')).toBeNull()
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(sections.composer.onSendWithWaggle).not.toHaveBeenCalled()

  act(() => {
    useSessionStore.getState().setActiveWorkspace(
      fromPartial<SessionWorkspace>({
        tree: { session: { id: sessionId, projectPath: '/test/project' } },
        activeBranchId: branchId,
        activeNodeId: null,
      }),
    )
  })
  await waitFor(() => expect(input).toHaveAttribute('contenteditable', 'true'))
  expect(input).toHaveTextContent('Saved prompt')
  expect(screen.queryByText('Loading session draft…')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  expect(sections.composer.onSendWithWaggle).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'Saved prompt' }),
  )
})
