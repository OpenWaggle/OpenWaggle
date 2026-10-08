import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { beforeEach, describe, expect, it } from 'vitest'
import { type OptimisticSteerPreview, useOptimisticSteerStore } from '../optimistic-steer-store'

const SESSION_ID = SessionId('session-1')

function preview(id: string): OptimisticSteerPreview {
  const message: UIMessage = {
    id,
    role: 'user',
    parts: [{ type: 'text', content: id }],
    createdAt: new Date(),
  }
  return {
    id,
    content: id,
    incorporatedContent: { text: id, attachmentCount: 0 },
    durableContent: id,
    baselineUserMessageIds: new Set<string>(),
    baselineMaxCreatedOrder: -1,
    message,
  }
}

describe('optimistic steer store', () => {
  beforeEach(() => {
    useOptimisticSteerStore.setState({ previews: new Map(), runIds: new Map() })
  })

  it('preserves previews added after a reconciliation render snapshot', () => {
    const first = preview('first')
    const later = preview('later')
    useOptimisticSteerStore.getState().add(SESSION_ID, first)
    const observed = [{ ...first, durableMessageId: 'durable-first' }]
    useOptimisticSteerStore.getState().add(SESSION_ID, later)

    useOptimisticSteerStore.getState().reconcile(SESSION_ID, observed, true)

    expect(useOptimisticSteerStore.getState().previews.get(SESSION_ID)).toEqual([later])
  })

  it('preserves a concurrent delivery-state update while recording durable matches', () => {
    const first = preview('first')
    const second = preview('second')
    useOptimisticSteerStore.getState().add(SESSION_ID, first)
    useOptimisticSteerStore.getState().add(SESSION_ID, second)
    const observed = [{ ...first, durableMessageId: 'durable-first' }, second]
    useOptimisticSteerStore.getState().update(SESSION_ID, second.id, (current) => ({
      ...current,
      message: { ...current.message, metadata: { steerDelivery: 'sending' } },
    }))

    useOptimisticSteerStore.getState().reconcile(SESSION_ID, observed, false)

    const reconciled = useOptimisticSteerStore.getState().previews.get(SESSION_ID)
    expect(reconciled?.[0]?.durableMessageId).toBe('durable-first')
    expect(reconciled?.[1]?.message.metadata?.steerDelivery).toBe('sending')
  })

  // A stall can hide a Run's settlement: once another Run starts, the Host has returned the
  // steers the earlier one never took to the queue.
  it('drops a preview promoted into a Run once another Run starts', () => {
    const store = useOptimisticSteerStore.getState()
    store.noteRunStarted(SESSION_ID, 'run-1')
    store.add(SESSION_ID, preview('into-run-1'))
    expect(useOptimisticSteerStore.getState().previews.get(SESSION_ID)?.[0]?.runId).toBe('run-1')
    // The Waggle run-1 requested goes on as run-1; a start the Host left unnamed tells nothing.
    store.noteRunStarted(SESSION_ID, 'waggle-of-run-1')
    store.noteRunStarted(SESSION_ID, 'remote-snapshot:session-1')
    expect(useOptimisticSteerStore.getState().previews.get(SESSION_ID)).toHaveLength(1)
    store.noteRunStarted(SESSION_ID, 'run-2')
    store.add(SESSION_ID, preview('into-run-2'))
    expect(
      useOptimisticSteerStore
        .getState()
        .previews.get(SESSION_ID)
        ?.map((turn) => turn.id),
    ).toEqual(['into-run-2'])
  })
})
