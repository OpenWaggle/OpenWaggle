import { SessionId, WorkingPath } from '@shared/types/brand'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerActionStore, useComposerStore } from '@/features/composer/state'
import { createRendererQueryClient } from '@/queries/query-client'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { useUIStore } from '@/shell/ui-store'
import { useSessionSummaryUIStore } from '../../state/session-summary-ui-store'
import {
  commitOrPushDialog,
  hubElement,
  listSessionResources,
  renderHub,
  resource,
  session,
  sessionSummarySectionOrder,
  setupSessionSummaryHubHarness,
  toggleSessionTerminal,
  useCombinedVcsStatus,
  useStackedGitActions,
} from './session-summary-hub.test-harness'

describe('SessionSummaryHub', () => {
  beforeEach(() => {
    setupSessionSummaryHubHarness()
  })

  it('routes its terminal action through the session-owned terminal commands', () => {
    renderHub()
    fireEvent.click(screen.getByRole('button', { name: 'Environment actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Toggle terminal' }))
    expect(toggleSessionTerminal).toHaveBeenCalledOnce()
  })

  it('keeps core and extension slots in the agreed deterministic order', () => {
    expect(sessionSummarySectionOrder()).toEqual([
      'subscriptions',
      'environment',
      'change-requests',
      'extensions-context',
      'hive',
      'extensions-coordination',
      'resource-catalog',
      'outputs',
      'sources',
      'extensions-details',
    ])
  })

  it('does not render before the opened session has its first message', () => {
    renderHub({ messageCount: 0 })
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
    expect(useStackedGitActions).not.toHaveBeenCalled()
    expect(listSessionResources).not.toHaveBeenCalled()
  })

  it('appears after the first message with environment actions', async () => {
    renderHub()
    expect(screen.getByRole('complementary', { name: 'Session Summary' })).toBeInTheDocument()
    expect(screen.getByText('Environment')).toBeInTheDocument()
    expect(screen.getByText('Changes')).toBeInTheDocument()
    expect(screen.getByText('Create PR')).toBeInTheDocument()
    await waitFor(() => expect(listSessionResources).toHaveBeenCalledWith(SessionId('session-1')))
  })

  it('retries the combined status after bounded local recovery fails', () => {
    const refresh = vi.fn()
    useCombinedVcsStatus.mockReturnValue({
      local: null,
      localState: 'error',
      remote: null,
      remoteState: 'error',
      status: null,
      refresh,
    })

    renderHub()
    fireEvent.click(screen.getByRole('button', { name: 'Retry Git status' }))

    expect(refresh).toHaveBeenCalledOnce()
  })

  it('keeps a failed resource catalog visible and retryable in the Summary', async () => {
    listSessionResources
      .mockRejectedValueOnce(new Error('catalog unavailable'))
      .mockResolvedValue({ resources: [], backfillComplete: true })
    renderHub()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load session resources.')
    const callsBeforeRetry = listSessionResources.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(listSessionResources.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeRetry + 2),
    )
  })

  it('keeps long summary content inside a bounded, scrollable surface', () => {
    renderHub()
    const summary = screen.getByRole('complementary', { name: 'Session Summary' })
    expect(summary).toHaveClass('max-h-full', 'max-w-full', 'overflow-hidden')
    expect(summary.parentElement).toHaveClass(
      'absolute',
      'right-4',
      'bottom-4',
      'left-4',
      'top-14',
      'items-start',
    )
    expect(summary.querySelector('.overflow-y-auto')).toBeInTheDocument()
  })

  it('lets the header state force the panel open when it is automatically hidden', () => {
    renderHub({ autoHidden: true })
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
    expect(useCombinedVcsStatus).toHaveBeenLastCalledWith(null, '1:0')

    act(() => useSessionSummaryUIStore.getState().togglePanel('session-1'))

    expect(screen.getByRole('complementary', { name: 'Session Summary' })).toHaveAttribute(
      'data-session-summary-mode',
      'transient',
    )
    expect(useCombinedVcsStatus).toHaveBeenLastCalledWith(WorkingPath('/project'), '1:0')
  })

  it('dismisses a constrained-width transient panel with Escape and restores toggle focus', async () => {
    renderHub({ autoHidden: true }, true)
    const toggle = screen.getByText('Session Summary toggle')
    fireEvent.click(toggle)
    const summary = screen.getByRole('complementary', { name: 'Session Summary' })
    const changes = screen.getByRole('button', { name: /Changes/ })
    changes.focus()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(summary).not.toBeInTheDocument()
    await waitFor(() => expect(toggle).toHaveFocus())
  })

  it('dismisses a constrained-width transient panel when focus moves outside it', () => {
    renderHub({ autoHidden: true }, true)
    const toggle = screen.getByText('Session Summary toggle')
    fireEvent.click(toggle)
    expect(screen.getByRole('complementary', { name: 'Session Summary' })).toBeInTheDocument()

    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
  })

  it('closes a nested menu before dismissing the transient Summary', () => {
    renderHub({ autoHidden: true }, true)
    fireEvent.click(screen.getByText('Session Summary toggle'))
    fireEvent.click(screen.getByRole('button', { name: 'Environment actions' }))
    const menuItem = screen.getByRole('menuitem', { name: 'Toggle terminal' })

    fireEvent.keyDown(menuItem, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Session Summary' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
  })

  it('leaves native image-dialog Escape uncancelled while the transient Summary stays open', () => {
    renderHub({ autoHidden: true }, true)
    fireEvent.click(screen.getByText('Session Summary toggle'))
    const closeImage = vi.fn()
    render(
      <ModalDialog label="Image viewer: reference.png" onClose={closeImage}>
        <Button onClick={closeImage}>Close image viewer</Button>
      </ModalDialog>,
    )
    const imageClose = screen.getByRole('button', { name: 'Close image viewer' })
    imageClose.focus()
    fireEvent.pointerDown(imageClose)
    expect(screen.getByRole('complementary', { name: 'Session Summary' })).toBeInTheDocument()

    // jsdom cannot perform native Escape dismissal. Check that the key's default remains
    // available to Chromium, then deliver the resulting native dialog cancel event.
    expect(fireEvent.keyDown(imageClose, { key: 'Escape' })).toBe(true)
    expect(screen.getByRole('complementary', { name: 'Session Summary' })).toBeInTheDocument()
    fireEvent(
      screen.getByRole('dialog', { name: 'Image viewer: reference.png' }),
      new Event('cancel', { cancelable: true }),
    )
    expect(closeImage).toHaveBeenCalledOnce()
  })

  it('hard-hides the panel while a right sidebar is open', () => {
    renderHub({ rightSidebarOpen: true })

    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
    expect(useCombinedVcsStatus).toHaveBeenLastCalledWith(null, '1:0')
  })

  it('does not load VCS state while persisted hidden and reloads it when reopened', () => {
    localStorage.setItem('openwaggle:session-summary:session-1:panel', 'false')
    renderHub({}, true)

    expect(useCombinedVcsStatus).toHaveBeenLastCalledWith(null, '1:0')
    fireEvent.click(screen.getByText('Session Summary toggle'))
    expect(useCombinedVcsStatus).toHaveBeenLastCalledWith(WorkingPath('/project'), '1:0')
  })

  it('keeps VCS state enabled while an opened Git dialog outlives panel suppression', () => {
    const client = createRendererQueryClient()
    const view = render(<QueryClientProvider client={client}>{hubElement()}</QueryClientProvider>)
    const commitOrPush = screen.getByRole('button', { name: 'Commit or push' })
    expect(commitOrPush).toBeEnabled()
    fireEvent.click(commitOrPush)
    expect(commitOrPushDialog).toHaveBeenCalled()
    expect(useCombinedVcsStatus).toHaveBeenLastCalledWith(WorkingPath('/project'), '1:0')

    view.rerender(
      <QueryClientProvider client={client}>{hubElement({ autoHidden: true })}</QueryClientProvider>,
    )

    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
    expect(commitOrPushDialog.mock.calls.length).toBeGreaterThan(1)
    expect(useCombinedVcsStatus).toHaveBeenLastCalledWith(WorkingPath('/project'), '1:0')
  })

  it('restores focus to the header toggle when suppression hides the focused panel', async () => {
    const view = renderHub({}, true)
    const changes = screen.getByRole('button', { name: /Changes/ })
    changes.focus()
    expect(changes).toHaveFocus()

    view.rerender(
      <QueryClientProvider client={view.client}>
        {hubElement({ rightSidebarOpen: true }, true)}
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Session Summary toggle')).toHaveFocus())
  })

  it('shows only resources returned for the opened session', async () => {
    listSessionResources.mockImplementation(async (sessionId: SessionId) => ({
      resources:
        sessionId === SessionId('session-2')
          ? [resource({ id: 'resource-2', sessionId, title: 'session-two.png' })]
          : [resource({ title: 'session-one.png' })],
      backfillComplete: true,
    }))

    const first = renderHub()
    fireEvent.click(await screen.findByRole('button', { name: /Sources/ }))
    expect(await screen.findByText('session-one.png')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all' })).toBeInTheDocument()
    expect(screen.queryByText('session-two.png')).toBeNull()

    first.unmount()
    renderHub({ activeSession: session('session-2') })
    fireEvent.click(await screen.findByRole('button', { name: /Sources/ }))
    expect(await screen.findByText('session-two.png')).toBeInTheDocument()
    expect(screen.queryByText('session-one.png')).toBeNull()
  })

  it('opens a Summary image in the active session gallery', async () => {
    listSessionResources.mockResolvedValue({
      resources: [resource({ title: 'reference.png' })],
      backfillComplete: true,
    })
    renderHub()

    fireEvent.click(await screen.findByRole('button', { name: 'Sources 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'reference.png' }))

    expect(useUIStore.getState().resourceViewer).toEqual({
      sessionId: 'session-1',
      resourceId: 'resource-1',
    })
  })

  it('routes Add source actions to the matching session composer', async () => {
    renderHub({ activeSession: session('session-owner') })

    fireEvent.click(await screen.findByRole('button', { name: 'Add a source' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Attach files/ }))
    expect(useComposerActionStore.getState().filePickerRequest).toMatchObject({
      sessionId: 'session-owner',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add a source' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Reference project file/ }))
    expect(useComposerStore.getState().input).toBe('@')
  })

  it('opens a non-image resource on its owning browser tab and selection', async () => {
    const onOpenResources = vi.fn()
    listSessionResources.mockResolvedValue({
      resources: [
        resource({
          kind: 'file',
          title: 'report.md',
          mimeType: 'text/markdown',
          isSource: false,
          isOutput: true,
        }),
      ],
      backfillComplete: true,
    })
    renderHub({ onOpenResources })

    fireEvent.click(await screen.findByRole('button', { name: 'Outputs 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'report.md' }))

    expect(onOpenResources).toHaveBeenCalledWith({ view: 'outputs', resourceId: 'resource-1' })
  })

  it('runs stacked actions against the session that owns the Summary', () => {
    renderHub({ activeSession: session('session-owner') })
    const options = useStackedGitActions.mock.calls.at(-1)?.[0]
    expect(options?.sessionId).toBe(SessionId('session-owner'))
  })

  it('persists collapsed state per session', () => {
    const first = renderHub({}, true)
    fireEvent.click(screen.getByRole('button', { name: 'Session Summary toggle' }))
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
    expect(localStorage.getItem('openwaggle:session-summary:session-1:panel')).toBe('false')
    first.unmount()

    renderHub()
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
  })
})
