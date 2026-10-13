import { SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBranchSummaryStore } from '@/features/chat/state/branch-summary-store'
import { useComposerStore } from '@/features/composer/state'
import { useProviderStore } from '@/features/providers/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { MessageNotDelivered } from '../../lib/message-delivery'
import { PI_SESSION_FILE_REFUSAL_NOTICE } from '../../lib/session-image-send-failure'
import { ChatPanelContent } from '../ChatPanel'
import { createSections } from './ChatPanel.test-utils'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    activateSessionResourceOwner: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getProviderModels: vi.fn().mockResolvedValue([]),
    getGitStatus: vi.fn().mockResolvedValue(null),
    listGitBranches: vi.fn().mockResolvedValue({ currentBranch: 'main', branches: [] }),
    listChangeRequests: vi.fn().mockResolvedValue({ ok: true, changeRequests: [] }),
    checkSessionWorktree: vi.fn().mockResolvedValue({ exists: false }),
    onGitWorkingTreeChanged: vi.fn(() => () => undefined),
    createGitWorktree: vi.fn().mockResolvedValue({ ok: true, message: 'Created' }),
    checkoutGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'Checked out' }),
    prepareAttachments: vi.fn().mockResolvedValue([]),
    querySessionControl: vi.fn().mockResolvedValue({
      contractVersion: 2,
      requestId: 'queue-query',
      outcome: {
        operation: 'queue-list',
        sessionId: SessionId('session-1'),
        queueState: 'running',
        queueRevision: 0,
        activeRunId: null,
        items: [],
        omittedBodyCount: 0,
      },
    }),
    onWaggleEvent: vi.fn(() => () => undefined),
    onWaggleTurnEvent: vi.fn(() => () => undefined),
  },
}))

function renderSections(sections = createSections()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatPanelContent sections={sections} />
    </QueryClientProvider>,
  )
}

const REFUSAL =
  "This Session's Pi session file was deleted outside OpenWaggle (/p/s.jsonl), so its history is gone and it cannot be continued."

/*
 * The composer the chat renders decides what a failed send leaves behind. A send the Session
 * refused because its Pi file cannot be used gives the text back, with a toast, and is not
 * logged as an error.
 */
describe('ChatPanel send refused because the Pi session file cannot be used', () => {
  beforeEach(() => {
    useBranchSummaryStore.setState(useBranchSummaryStore.getInitialState())
    useComposerStore.setState(useComposerStore.getInitialState())
    useSessionStore.setState({ activeWorkspace: null, draftBranch: null })
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: {
        ...DEFAULT_SETTINGS,
        projectPath: '/test/project',
        selectedModel: SupportedModelId('openai/gpt-5'),
      },
      isLoaded: true,
    })
    useProviderStore.setState({ ...useProviderStore.getInitialState(), providerModels: [] })
  })

  it('restores the text in the composer and says so in a toast', async () => {
    Range.prototype.getBoundingClientRect = () => new DOMRect()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onToast = vi.fn()
    const onSendWithWaggle = vi.fn().mockRejectedValue(new MessageNotDelivered('refused', REFUSAL))
    const sessionId = SessionId('session-1')
    const branchId = SessionBranchId('session-1:main')
    const draftKey = `project:/test/project:session:${sessionId}:branch:${branchId}`
    useComposerStore
      .getState()
      .saveScopedDraft(draftKey, { input: 'Are you there?', attachments: [] })
    renderSections(createSections({}, { onToast, onSendWithWaggle }))
    act(() => {
      useSessionStore.getState().setActiveWorkspace(
        fromPartial<SessionWorkspace>({
          tree: { session: { id: sessionId, projectPath: '/test/project' } },
          activeBranchId: branchId,
          activeNodeId: null,
        }),
      )
    })
    const send = screen.getByRole('button', { name: 'Send message' })
    await waitFor(() => expect(send).toBeEnabled())

    fireEvent.click(send)

    expect(onSendWithWaggle).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Are you there?' }),
    )
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(PI_SESSION_FILE_REFUSAL_NOTICE))
    expect(useComposerStore.getState().input).toBe('Are you there?')
    const logged = consoleError.mock.calls.flat().map(String)
    expect(logged.filter((line) => line.includes('Composer send failed'))).toEqual([])
    consoleError.mockRestore()
  })
})
