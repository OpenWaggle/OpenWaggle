import { SessionId } from '@shared/types/brand'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionFollowUpQueueSnapshot } from '@/features/chat/hooks'
import {
  heldItem,
  openedEdit,
  queueItem,
  snapshotOf,
} from '../../hooks/__tests__/queued-message-edit.test-support'
import { useComposerActivityStore } from '../../state/composer-activity-store'
import { useComposerStore } from '../../state/composer-store'
import { useQueuedMessageEditStore } from '../../state/queued-message-edit-store'
import { QueuedMessages } from '../QueuedMessages'

const queueMock = vi.hoisted(() => {
  const mock: { snapshot: SessionFollowUpQueueSnapshot } & Record<
    'beginEdit' | 'withdraw',
    ReturnType<typeof vi.fn>
  > = {
    snapshot: { state: 'running', revision: 1, activeRunId: null, items: [], waitingOnEdit: false },
    beginEdit: vi.fn(),
    withdraw: vi.fn(),
  }
  return mock
})

vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionFollowUpQueue: () => ({
    snapshot: queueMock.snapshot,
    error: null,
    refresh: vi.fn(),
    beginEdit: queueMock.beginEdit,
    withdraw: queueMock.withdraw,
  }),
}))

const SESSION = SessionId('session-a')
const KEY_A = 'project:/repo:session:session-a:main'
const MINE = queueItem({ id: 'mine', text: 'my message' })
const THEIRS = queueItem({ id: 'theirs', text: 'worker message', editable: false })

function renderDock() {
  return render(
    <QueuedMessages sessionId={SESSION} onSteer={vi.fn()} isStreaming onToast={vi.fn()} />,
  )
}

function rowFor(text: string) {
  const row = screen.getByText(text).closest('li')
  if (!row) throw new Error(`No queued row for ${text}`)
  return row
}

describe('QueuedMessages editing', () => {
  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useComposerStore.getState().switchScopedDraftContext(KEY_A)
    useQueuedMessageEditStore.setState({ edits: {} })
    useComposerActivityStore.setState({ preparingAttachments: 0, pendingSubmissions: 0 })
    queueMock.snapshot = snapshotOf([MINE, THEIRS])
    queueMock.beginEdit.mockReset().mockResolvedValue(openedEdit(MINE))
    queueMock.withdraw.mockReset().mockResolvedValue(undefined)
  })

  it('offers Edit only on messages this user may edit', () => {
    renderDock()

    expect(
      within(rowFor('my message')).getByRole('button', { name: 'Edit queued message: my message' }),
    ).toHaveAttribute('aria-disabled', 'false')
    expect(
      within(rowFor('worker message')).queryByRole('button', { name: /^Edit queued message/ }),
    ).not.toBeInTheDocument()
  })

  it('begins an edit from the row', async () => {
    renderDock()

    fireEvent.click(screen.getByRole('button', { name: 'Edit queued message: my message' }))

    await waitFor(() => expect(queueMock.beginEdit).toHaveBeenCalledWith('mine'))
    await waitFor(() => expect(useComposerStore.getState().input).toBe('my message'))
  })

  it('marks a held message as being edited and hides its Steer', () => {
    queueMock.snapshot = snapshotOf([heldItem(MINE), THEIRS])
    renderDock()

    const held = rowFor('my message')
    expect(within(held).getByText('Being edited')).toBeInTheDocument()
    expect(within(held).queryByRole('button', { name: 'Steer' })).not.toBeInTheDocument()
    expect(within(held).getByRole('button', { name: /^Edit queued message/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(
      within(rowFor('worker message')).getByRole('button', { name: 'Steer' }),
    ).toBeInTheDocument()
  })

  it('disables Edit on other rows while an edit is open in this Session', () => {
    const other = queueItem({ id: 'other', text: 'another of mine' })
    queueMock.snapshot = snapshotOf([MINE, other])
    useQueuedMessageEditStore.getState().setEdit('session-a', {
      phase: 'editing',
      followUpId: 'mine',
      contextKey: KEY_A,
      based: openedEdit(MINE),
    })
    renderDock()

    const edit = screen.getByRole('button', { name: 'Edit queued message: another of mine' })
    expect(edit).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(edit)
    expect(queueMock.beginEdit).not.toHaveBeenCalled()
  })

  it('disables Edit while the composer is preparing an attachment or acknowledging a send', () => {
    useComposerActivityStore.setState({ preparingAttachments: 1 })
    const view = renderDock()
    const edit = () => screen.getByRole('button', { name: 'Edit queued message: my message' })
    expect(edit()).toHaveAttribute('aria-disabled', 'true')

    act(() => useComposerActivityStore.setState({ preparingAttachments: 0, pendingSubmissions: 1 }))
    expect(edit()).toHaveAttribute('aria-disabled', 'true')
    act(() => useComposerActivityStore.setState({ pendingSubmissions: 0 }))
    expect(edit()).toHaveAttribute('aria-disabled', 'false')
    view.unmount()
  })

  it('cannot dismiss the message while its save is in flight', () => {
    queueMock.snapshot = snapshotOf([heldItem(MINE)])
    useQueuedMessageEditStore.getState().setEdit('session-a', {
      phase: 'saving',
      followUpId: 'mine',
      contextKey: KEY_A,
      based: openedEdit(MINE),
    })
    renderDock()

    const dismiss = within(rowFor('my message')).getByTitle('Dismiss')
    expect(dismiss).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(dismiss)
    expect(queueMock.withdraw).not.toHaveBeenCalled()
  })

  it('ends the edit when the message being edited is dismissed', async () => {
    useComposerStore.getState().setInput('my draft')
    useQueuedMessageEditStore.getState().setEdit('session-a', {
      phase: 'editing',
      followUpId: 'mine',
      contextKey: KEY_A,
      based: openedEdit(MINE),
    })
    useComposerStore.getState().saveScopedDraft('follow-up-edit:session:session-a:stash', {
      input: 'my draft',
      attachments: [],
    })
    useComposerStore.getState().setInput('editing text')
    renderDock()

    fireEvent.click(within(rowFor('my message')).getByTitle('Dismiss'))

    await waitFor(() => expect(useQueuedMessageEditStore.getState().edits).toEqual({}))
    expect(useComposerStore.getState().input).toBe('my draft')
  })
})
