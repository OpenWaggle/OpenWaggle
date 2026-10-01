import { SessionId } from '@shared/types/brand'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionFollowUpQueueItem, SessionFollowUpQueueSnapshot } from '@/features/chat/hooks'
import { useOptimisticSteerStore } from '@/features/chat/state'
import { queueItem, snapshotOf } from '../../hooks/__tests__/queued-message-edit.test-support'
import { QueuedMessages } from '../QueuedMessages'

/** A queue whose reorder really reorders it and re-renders, like the Host and the query cache. */
const queueMock = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const mock: {
    snapshot: SessionFollowUpQueueSnapshot
    subscribe: (listener: () => void) => () => void
    publish: (snapshot: SessionFollowUpQueueSnapshot) => void
  } = {
    snapshot: { state: 'running', revision: 1, activeRunId: null, items: [], waitingOnEdit: false },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish(snapshot) {
      mock.snapshot = snapshot
      for (const listener of listeners) listener()
    },
  }
  return mock
})

vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', async (importOriginal) => {
  const { useSyncExternalStore } = await import('react')
  return {
    ...(await importOriginal<object>()),
    useSessionFollowUpQueue: () => {
      const snapshot = useSyncExternalStore(queueMock.subscribe, () => queueMock.snapshot)
      return {
        snapshot,
        error: null,
        refresh: () => Promise.resolve(queueMock.snapshot),
        reorder: (order: readonly string[]) => {
          const byId = new Map(queueMock.snapshot.items.map((item) => [item.id, item]))
          const items = order.flatMap((id) => byId.get(id) ?? [])
          // The query cache notifies on a later task, so the dock re-renders after the move resolves.
          setTimeout(() => queueMock.publish(snapshotOf(items, queueMock.snapshot.revision + 1)), 0)
          return Promise.resolve()
        },
      }
    },
  }
})

const SESSION = SessionId('session-a')
const ITEMS: SessionFollowUpQueueItem[] = [
  queueItem({ id: 'a', text: 'first' }),
  queueItem({ id: 'b', text: 'second' }),
  queueItem({ id: 'c', text: 'third' }),
]

function renderDock() {
  return render(
    <QueuedMessages sessionId={SESSION} onSteer={vi.fn()} isStreaming onToast={vi.fn()} />,
  )
}

function grip(text: string) {
  return screen.getByRole('button', { name: `Reorder ${text}` })
}

async function moveWithMenu(text: string, direction: 'Move up' | 'Move down') {
  grip(text).focus()
  fireEvent.click(grip(text))
  fireEvent.click(await screen.findByRole('menuitem', { name: direction }))
}

function renderedOrder() {
  return [...document.querySelectorAll<HTMLElement>('[data-qa="queued-message-row"]')].map(
    (row) => row.dataset.followUpId,
  )
}

/**
 * Browsers blur a focused element whose node is moved; jsdom does not. Emulate it, so focusing
 * before React relocates the moved row fails here as it does in the app.
 */
function blurWhenFocusedNodeMoves() {
  const blurIfMoving = (node: Node) => {
    const active = document.activeElement
    return node.isConnected && active instanceof HTMLElement && node.contains(active)
      ? () => active.blur()
      : () => undefined
  }
  const insertBefore = Node.prototype.insertBefore
  vi.spyOn(Node.prototype, 'insertBefore').mockImplementation(function <T extends Node>(
    this: Node,
    node: T,
    child: Node | null,
  ) {
    const blur = blurIfMoving(node)
    insertBefore.call(this, node, child)
    blur()
    return node
  })
  const appendChild = Node.prototype.appendChild
  vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function <T extends Node>(
    this: Node,
    node: T,
  ) {
    const blur = blurIfMoving(node)
    appendChild.call(this, node)
    blur()
    return node
  })
}

/** The rendered order at each moment a grip is focused. */
function recordOrderWhenGripFocused() {
  const orders: (string | undefined)[][] = []
  const focus = HTMLElement.prototype.focus
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    if (this.dataset.qa === 'queued-message-grip') orders.push(renderedOrder())
    focus.call(this, options)
  })
  return orders
}

function announcementNode() {
  return screen.getByText(/^Moved to position/)
}

describe('QueuedMessages reorder focus', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    queueMock.snapshot = snapshotOf(ITEMS, 4)
    useOptimisticSteerStore.setState({ pendingPromotions: new Map() })
  })

  it('keeps focus on the moved message after Move down, once the new order is on screen', async () => {
    // A browser blurs a focused row React relocates, so focus must land after the reorder commits.
    blurWhenFocusedNodeMoves()
    renderDock()

    await moveWithMenu('first', 'Move down')

    await waitFor(() => expect(renderedOrder()).toEqual(['b', 'a', 'c']))
    await waitFor(() => expect(grip('first')).toHaveFocus())
    expect(announcementNode()).toHaveTextContent('Moved to position 2 of 3.')
  })

  it('keeps focus on the moved message after Move up', async () => {
    renderDock()

    await moveWithMenu('third', 'Move up')

    await waitFor(() => expect(renderedOrder()).toEqual(['a', 'c', 'b']))
    await waitFor(() => expect(grip('third')).toHaveFocus())
  })

  it('keeps focus on a message dragged down', async () => {
    blurWhenFocusedNodeMoves()
    renderDock()
    const data = new Map<string, string>()
    const types: string[] = []
    const dataTransfer = {
      effectAllowed: 'none',
      types,
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
    }
    const target = () => screen.getByText('third').closest('li')
    grip('first').focus()
    const ordersWhenGripFocused = recordOrderWhenGripFocused()

    fireEvent.dragStart(grip('first'), { dataTransfer })
    fireEvent.dragOver(target() ?? document.body, { dataTransfer })
    fireEvent.drop(target() ?? document.body, { dataTransfer })

    await waitFor(() => expect(renderedOrder()).toEqual(['b', 'c', 'a']))
    await waitFor(() => expect(grip('first')).toHaveFocus())
    // Focused only once the moved row is in place, never on the row React is about to relocate.
    expect(ordersWhenGripFocused.length).toBeGreaterThan(0)
    for (const order of ordersWhenGripFocused) expect(order).toEqual(['b', 'c', 'a'])
  })

  it('reads the same announcement again for a second identical move result', async () => {
    renderDock()
    await moveWithMenu('first', 'Move down')
    await waitFor(() => expect(renderedOrder()).toEqual(['b', 'a', 'c']))
    const firstAnnouncement = announcementNode()

    await moveWithMenu('first', 'Move up')
    await waitFor(() => expect(renderedOrder()).toEqual(['a', 'b', 'c']))
    await moveWithMenu('first', 'Move down')
    await waitFor(() => expect(renderedOrder()).toEqual(['b', 'a', 'c']))

    await act(() => Promise.resolve())
    expect(announcementNode()).toHaveTextContent('Moved to position 2 of 3.')
    // A new node, so assistive technology announces it rather than seeing unchanged text.
    expect(announcementNode()).not.toBe(firstAnnouncement)
  })
})
