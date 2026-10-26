import { SessionId } from '@shared/types/brand'
import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionFollowUpQueueSnapshot } from '@/features/chat/hooks'
import { useOptimisticSteerStore } from '@/features/chat/state'
import { queueItem, snapshotOf } from '../../hooks/__tests__/queued-message-edit.test-support'
import { QueuedMessages } from '../QueuedMessages'
import { fireDrag, makeDataTransfer, placeElement } from './queued-message-drag.test-support'

const queueMock = vi.hoisted(() => {
  const mock: { snapshot: SessionFollowUpQueueSnapshot } & Record<
    'reorder' | 'refresh',
    ReturnType<typeof vi.fn>
  > = {
    snapshot: { state: 'running', revision: 1, activeRunId: null, items: [], waitingOnEdit: false },
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

function renderDock() {
  return render(
    <QueuedMessages sessionId={SESSION} onSteer={vi.fn()} isStreaming onToast={vi.fn()} />,
  )
}

function rowFor(text: string) {
  // Within the list: the drag image is a copy of a row, in the document until the next task.
  const row = within(screen.getByRole('list', { name: 'Queued messages' }))
    .getByText(text)
    .closest('li')
  if (!row) throw new Error(`No queued row for ${text}`)
  return row
}

function grip(text: string) {
  return screen.getByRole('button', { name: `Reorder ${text}` })
}

function list() {
  return screen.getByRole('list', { name: 'Queued messages' })
}

function dropTargets() {
  return [...document.querySelectorAll<HTMLElement>('[data-drop-target]')].map(
    (row) => `${row.dataset.followUpId ?? ''}:${row.dataset.dropTarget ?? ''}`,
  )
}

/** The element handed to setDragImage on the drag's first and only call. */
function dragImageOf(dataTransfer: ReturnType<typeof makeDataTransfer>) {
  expect(dataTransfer.setDragImage).toHaveBeenCalledTimes(1)
  const image = dataTransfer.setDragImage.mock.calls[0]?.[0]
  if (!(image instanceof HTMLElement)) throw new Error('No drag image element')
  return image
}

describe('QueuedMessages drag feedback', () => {
  beforeEach(() => {
    queueMock.snapshot = snapshotOf(
      [
        queueItem({ id: 'a', text: 'first' }),
        queueItem({ id: 'b', text: 'second' }),
        queueItem({ id: 'c', text: 'third', attachmentCount: 2 }),
      ],
      4,
    )
    queueMock.reorder.mockReset().mockResolvedValue(undefined)
    queueMock.refresh.mockReset().mockResolvedValue(undefined)
    useOptimisticSteerStore.setState({ pendingPromotions: new Map() })
  })

  describe('drag image', () => {
    it('drags a copy of the whole row, held where the pointer took it', async () => {
      renderDock()
      placeElement(rowFor('third'), { left: 100, top: 200, width: 320, height: 40 })
      const dataTransfer = makeDataTransfer()
      let renderedWhenSet = false
      dataTransfer.setDragImage.mockImplementation((image) => {
        renderedWhenSet = image.isConnected
      })

      fireDrag('dragStart', grip('third'), dataTransfer, { clientX: 130, clientY: 210 })

      const image = dragImageOf(dataTransfer)
      expect(image).not.toBe(grip('third'))
      expect(renderedWhenSet).toBe(true)
      expect(image).toHaveTextContent('third')
      expect(image).toHaveTextContent('2 attachments')
      expect(image.querySelector('li')).toHaveStyle({ width: '320px' })
      // The image frame's 1px border sits around the copy, so the pointer keeps its place on it.
      expect(dataTransfer.setDragImage).toHaveBeenCalledWith(image, 31, 11)
      await waitFor(() => expect(image.isConnected).toBe(false))
    })

    it('renders the copy off screen, out of layout and out of the accessibility tree', () => {
      renderDock()
      const dataTransfer = makeDataTransfer()

      fireDrag('dragStart', grip('third'), dataTransfer, { clientX: 0, clientY: 0 })

      const image = dragImageOf(dataTransfer)
      expect(image).toHaveStyle({ position: 'fixed', pointerEvents: 'none' })
      expect(Number.parseFloat(image.style.left)).toBeLessThan(-1000)
      expect(image).toHaveAttribute('aria-hidden', 'true')
      expect(image).toHaveAttribute('inert')
      expect(list().contains(image)).toBe(false)
      // A copy that still looked like a row would be picked up by row lookups and focus moves.
      expect(image.querySelector('[data-qa="queued-message-row"]')).toBeNull()
      expect(image.querySelector('[data-follow-up-id]')).toBeNull()
      expect(image.querySelector('[id]')).toBeNull()
    })

    it('clamps a long message in the copy, but not in the list', () => {
      queueMock.snapshot = snapshotOf(
        [
          queueItem({ id: 'a', text: 'first' }),
          queueItem({ id: 'b', text: 'line one\nline two\nline three\nline four\nline five' }),
        ],
        4,
      )
      renderDock()
      const dataTransfer = makeDataTransfer()

      fireDrag('dragStart', grip('line one'), dataTransfer)

      expect(within(dragImageOf(dataTransfer)).getByText(/line five/)).toHaveClass('line-clamp-3')
      expect(within(list()).getByText(/line five/)).not.toHaveClass('line-clamp-3')
    })
  })

  describe('placeholder', () => {
    it('leaves the source row in place as a placeholder until the drag ends', () => {
      renderDock()
      const dataTransfer = makeDataTransfer()

      fireDrag('dragStart', grip('second'), dataTransfer)

      expect(rowFor('second')).toHaveAttribute('data-drag-source', 'true')
      expect(rowFor('first')).not.toHaveAttribute('data-drag-source')
      // The image was taken from the row before it was dimmed.
      expect(dragImageOf(dataTransfer).querySelector('[data-drag-source]')).toBeNull()

      fireDrag('dragEnd', grip('second'), dataTransfer)

      expect(rowFor('second')).not.toHaveAttribute('data-drag-source')
    })
  })

  describe('drop indicator', () => {
    it('shows one drop line at a time, on the row the pointer is over', () => {
      renderDock()
      const dataTransfer = makeDataTransfer()

      fireDrag('dragStart', grip('third'), dataTransfer)
      fireDrag('dragOver', rowFor('first'), dataTransfer)
      expect(dropTargets()).toEqual(['a:before'])

      fireDrag('dragOver', rowFor('second'), dataTransfer)
      expect(dropTargets()).toEqual(['b:before'])
    })

    it('shows no line on the dragged row itself, and refuses the drop there', () => {
      renderDock()
      const dataTransfer = makeDataTransfer()

      fireDrag('dragStart', grip('second'), dataTransfer)
      fireDrag('dragOver', rowFor('third'), dataTransfer)
      const notPrevented = fireDrag('dragOver', rowFor('second'), dataTransfer)

      expect(notPrevented).toBe(true)
      expect(dropTargets()).toEqual([])
    })

    it('keeps the line while the pointer crosses the gap between rows, and drops there', async () => {
      renderDock()
      const dataTransfer = makeDataTransfer()

      fireDrag('dragStart', grip('first'), dataTransfer)
      fireDrag('dragOver', rowFor('third'), dataTransfer)
      fireDrag('dragLeave', rowFor('third'), dataTransfer, { relatedTarget: list() })
      const gapAccepted = !fireDrag('dragOver', list(), dataTransfer)

      expect(gapAccepted).toBe(true)
      expect(dropTargets()).toEqual(['c:after'])
      expect(dataTransfer.dropEffect).toBe('move')

      fireDrag('drop', list(), dataTransfer)
      fireDrag('dragEnd', grip('first'), dataTransfer)

      await waitFor(() => expect(queueMock.reorder).toHaveBeenCalledWith(['b', 'c', 'a'], 4))
      expect(dropTargets()).toEqual([])
    })

    it('ignores drags that did not start on a queued message grip', () => {
      renderDock()
      const dataTransfer = makeDataTransfer()
      dataTransfer.setData('Files', 'report.pdf')

      const notPrevented = fireDrag('dragOver', rowFor('second'), dataTransfer)

      expect(notPrevented).toBe(true)
      expect(dropTargets()).toEqual([])
    })
  })

  describe('cancelling', () => {
    it('changes nothing when the drag is cancelled with Escape', () => {
      renderDock()
      const dataTransfer = makeDataTransfer()

      fireDrag('dragStart', grip('first'), dataTransfer)
      fireDrag('dragOver', rowFor('third'), dataTransfer)
      // Chromium ends a drag cancelled with Escape with dragend and no drop.
      fireDrag('dragEnd', grip('first'), dataTransfer)

      expect(queueMock.reorder).not.toHaveBeenCalled()
      expect(dropTargets()).toEqual([])
      expect(document.querySelector('[data-drag-source]')).toBeNull()
    })

    it('changes nothing when the message is dropped outside the list', () => {
      renderDock()
      const dataTransfer = makeDataTransfer()

      fireDrag('dragStart', grip('first'), dataTransfer)
      fireDrag('dragOver', rowFor('third'), dataTransfer)
      fireDrag('dragLeave', list(), dataTransfer, { relatedTarget: document.body })
      expect(dropTargets()).toEqual([])

      fireDrag('drop', document.body, dataTransfer)
      fireDrag('dragEnd', grip('first'), dataTransfer)

      expect(queueMock.reorder).not.toHaveBeenCalled()
      expect(document.querySelector('[data-drag-source]')).toBeNull()
    })

    it('ends the drag when the dragged message leaves the queue mid-drag', () => {
      const { rerender } = renderDock()
      const dataTransfer = makeDataTransfer()

      fireDrag('dragStart', grip('first'), dataTransfer)
      fireDrag('dragOver', rowFor('third'), dataTransfer)
      // Delivered as the next Run: its row unmounts, so its dragend never reaches React.
      queueMock.snapshot = snapshotOf(
        [queueItem({ id: 'b', text: 'second' }), queueItem({ id: 'c', text: 'third' })],
        5,
      )
      rerender(
        <QueuedMessages sessionId={SESSION} onSteer={vi.fn()} isStreaming onToast={vi.fn()} />,
      )

      expect(dropTargets()).toEqual([])
      expect(fireDrag('dragOver', list(), dataTransfer)).toBe(true)
      fireDrag('drop', list(), dataTransfer)
      expect(queueMock.reorder).not.toHaveBeenCalled()
    })

    it('does not reuse a cancelled drag for a later drop', () => {
      renderDock()
      const dataTransfer = makeDataTransfer()

      fireDrag('dragStart', grip('first'), dataTransfer)
      fireDrag('dragOver', rowFor('third'), dataTransfer)
      fireDrag('dragEnd', grip('first'), dataTransfer)
      fireDrag('drop', rowFor('third'), dataTransfer)

      expect(queueMock.reorder).not.toHaveBeenCalled()
    })
  })

  it('shows how many attachments a message with text carries', () => {
    renderDock()

    expect(rowFor('third')).toHaveTextContent('2 attachments')
    expect(rowFor('first')).not.toHaveTextContent('attachment')
  })
})
