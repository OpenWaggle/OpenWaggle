import { SessionId } from '@shared/types/brand'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SessionControlRejectedError,
  type SessionFollowUpQueueSnapshot,
} from '@/features/chat/hooks'
import { useOptimisticSteerStore } from '@/features/chat/state'
import { queueItem, snapshotOf } from '../../hooks/__tests__/queued-message-edit.test-support'
import { MOVE_NOT_APPLIED_MESSAGE } from '../../hooks/useQueuedMessageReorder'
import { QUEUED_MESSAGE_DRAG_TYPE } from '../QueuedMessageReorderHandle'
import { QueuedMessages } from '../QueuedMessages'

const queueMock = vi.hoisted(() => {
  const mock: { snapshot: SessionFollowUpQueueSnapshot } & Record<
    'reorder' | 'refresh',
    ReturnType<typeof vi.fn>
  > = {
    snapshot: { state: 'running', revision: 1, activeRunId: null, items: [] },
    reorder: vi.fn(),
    refresh: vi.fn(),
  }
  return mock
})

vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionFollowUpQueue: () => ({
    snapshot: queueMock.snapshot,
    error: null,
    refresh: queueMock.refresh,
    reorder: queueMock.reorder,
  }),
}))

const SESSION = SessionId('session-a')
const toast = vi.fn()

function renderDock() {
  return render(
    <QueuedMessages sessionId={SESSION} onSteer={vi.fn()} isStreaming onToast={toast} />,
  )
}

function rowFor(text: string) {
  const row = screen.getByText(text).closest('li')
  if (!row) throw new Error(`No queued row for ${text}`)
  return row
}

function makeDataTransfer() {
  const data = new Map<string, string>()
  return {
    effectAllowed: 'none',
    get types() {
      return [...data.keys()]
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
  }
}

describe('QueuedMessages reordering', () => {
  beforeEach(() => {
    queueMock.snapshot = snapshotOf(
      [
        queueItem({ id: 'a', text: 'first' }),
        queueItem({ id: 'b', text: 'second' }),
        queueItem({ id: 'c', text: 'third' }),
      ],
      4,
    )
    queueMock.reorder.mockReset().mockResolvedValue(undefined)
    queueMock.refresh.mockReset().mockResolvedValue(undefined)
    useOptimisticSteerStore.setState({ pendingPromotions: new Map() })
    toast.mockClear()
  })

  it('moves a message by dragging its handle onto another row', async () => {
    renderDock()
    const dataTransfer = makeDataTransfer()

    fireEvent.dragStart(screen.getByRole('button', { name: 'Reorder third' }), { dataTransfer })
    fireEvent.dragOver(rowFor('first'), { dataTransfer })
    fireEvent.drop(rowFor('first'), { dataTransfer })

    await waitFor(() => expect(queueMock.reorder).toHaveBeenCalledWith(['c', 'a', 'b'], 4))
    expect(dataTransfer.getData(QUEUED_MESSAGE_DRAG_TYPE)).toBe('c')
  })

  it('shows the drop line on the side where the message will land', () => {
    renderDock()
    const dataTransfer = makeDataTransfer()

    fireEvent.dragStart(screen.getByRole('button', { name: 'Reorder first' }), { dataTransfer })
    fireEvent.dragOver(rowFor('third'), { dataTransfer })
    expect(rowFor('third')).toHaveAttribute('data-drop-target', 'after')
    fireEvent.dragEnd(screen.getByRole('button', { name: 'Reorder first' }), { dataTransfer })

    fireEvent.dragStart(screen.getByRole('button', { name: 'Reorder third' }), { dataTransfer })
    fireEvent.dragOver(rowFor('first'), { dataTransfer })
    expect(rowFor('first')).toHaveAttribute('data-drop-target', 'before')
  })

  it('ignores drops that are not a queued message', () => {
    renderDock()
    const dataTransfer = makeDataTransfer()
    dataTransfer.setData('text/plain', 'b')

    fireEvent.drop(rowFor('first'), { dataTransfer })

    expect(queueMock.reorder).not.toHaveBeenCalled()
  })

  it('moves a message from the keyboard through the handle menu', async () => {
    renderDock()

    fireEvent.click(screen.getByRole('button', { name: 'Reorder second' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move up' }))

    await waitFor(() => expect(queueMock.reorder).toHaveBeenCalledWith(['b', 'a', 'c'], 4))
    // Focus follows the moved message, and the new place is announced.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reorder second' })).toHaveFocus(),
    )
    expect(screen.getByText('Moved to position 1 of 3.')).toBeInTheDocument()
  })

  it('offers only the moves a row can make', async () => {
    renderDock()

    fireEvent.click(screen.getByRole('button', { name: 'Reorder first' }))

    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Move up' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Move down' })).toBeInTheDocument()
  })

  it('has no handle when there is nothing to reorder', () => {
    queueMock.snapshot = snapshotOf([queueItem({ id: 'a', text: 'only' })])
    renderDock()

    expect(screen.queryByRole('button', { name: /^Reorder/ })).not.toBeInTheDocument()
  })

  it('keeps a message reserved by a steering promotion locked in its slot', async () => {
    act(() => {
      useOptimisticSteerStore.getState().beginPromotion(SESSION, 'b')
    })
    renderDock()

    expect(screen.queryByText('second')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reorder third' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move up' }))

    await waitFor(() => expect(queueMock.reorder).toHaveBeenCalledWith(['c', 'b', 'a'], 4))
  })

  it('replays a move once against the refetched queue without telling the user', async () => {
    queueMock.reorder.mockRejectedValueOnce(
      new SessionControlRejectedError('queue-reorder', 'queue_revision_changed'),
    )
    queueMock.refresh.mockResolvedValueOnce(
      snapshotOf(
        [
          queueItem({ id: 'x', text: 'new first' }),
          queueItem({ id: 'a', text: 'first' }),
          queueItem({ id: 'b', text: 'second' }),
          queueItem({ id: 'c', text: 'third' }),
        ],
        5,
      ),
    )
    renderDock()

    fireEvent.click(screen.getByRole('button', { name: 'Reorder second' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move up' }))

    // Still "just before first", not "position 1" of a queue that changed underneath.
    await waitFor(() => expect(queueMock.reorder).toHaveBeenLastCalledWith(['x', 'b', 'a', 'c'], 5))
    expect(toast).not.toHaveBeenCalled()
  })

  it('says so when the move can no longer be applied', async () => {
    queueMock.reorder.mockRejectedValueOnce(
      new SessionControlRejectedError('queue-reorder', 'queue_revision_changed'),
    )
    queueMock.refresh.mockResolvedValueOnce(
      snapshotOf([queueItem({ id: 'a', text: 'first' }), queueItem({ id: 'c', text: 'third' })], 5),
    )
    renderDock()

    fireEvent.click(screen.getByRole('button', { name: 'Reorder second' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move up' }))

    await waitFor(() => expect(toast).toHaveBeenCalledWith(MOVE_NOT_APPLIED_MESSAGE))
    expect(queueMock.reorder).toHaveBeenCalledTimes(1)
  })
})
