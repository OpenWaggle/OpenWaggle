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
  return { id, content: id, baselineLength: 0, message }
}

describe('optimistic steer store', () => {
  beforeEach(() => {
    useOptimisticSteerStore.setState({ previews: new Map() })
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
})
