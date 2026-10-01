import { SessionId } from '@shared/types/brand'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionFollowUpQueueSnapshot } from '@/features/chat/hooks'
import {
  heldItem,
  openedEdit,
  queueItem,
  snapshotOf,
} from '../../hooks/__tests__/queued-message-edit.test-support'
import { useComposerStore } from '../../state/composer-store'
import { useQueuedMessageEditStore } from '../../state/queued-message-edit-store'
import { QueuedMessages } from '../QueuedMessages'

const queueMock = vi.hoisted(() => {
  const mock: { snapshot: SessionFollowUpQueueSnapshot } & Record<
    'beginEdit' | 'withdraw',
    ReturnType<typeof vi.fn>
  > = {
    snapshot: { state: 'running', revision: 1, activeRunId: null, items: [] },
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
    useComposerStore.getState().switchScopedDraftContext('project:/repo:session:session-a:main')
    useQueuedMessageEditStore.setState({ edits: {} })
    queueMock.snapshot = snapshotOf([MINE, THEIRS])
    queueMock.beginEdit.mockReset().mockResolvedValue(openedEdit(MINE))
    queueMock.withdraw.mockReset().mockResolvedValue(undefined)
  })

  it('offers Edit only on messages this user may edit', () => {
    renderDock()

    expect(
      within(rowFor('my message')).getByRole('button', { name: 'Edit queued message: my message' }),
    ).toBeEnabled()
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
    expect(within(held).getByRole('button', { name: /^Edit queued message/ })).toBeDisabled()
    expect(
      within(rowFor('worker message')).getByRole('button', { name: 'Steer' }),
    ).toBeInTheDocument()
  })

  it('disables Edit on other rows while an edit is open in this Session', () => {
    const other = queueItem({ id: 'other', text: 'another of mine' })
    queueMock.snapshot = snapshotOf([MINE, other])
    useQueuedMessageEditStore
      .getState()
      .setEdit('session-a', { phase: 'editing', followUpId: 'mine', based: openedEdit(MINE) })
    renderDock()

    expect(
      screen.getByRole('button', { name: 'Edit queued message: another of mine' }),
    ).toBeDisabled()
  })

  it('ends the edit when the message being edited is dismissed', async () => {
    useComposerStore.getState().setInput('my draft')
    useQueuedMessageEditStore
      .getState()
      .setEdit('session-a', { phase: 'editing', followUpId: 'mine', based: openedEdit(MINE) })
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
