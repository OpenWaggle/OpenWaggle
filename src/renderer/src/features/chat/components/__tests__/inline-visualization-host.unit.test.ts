import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/ipc', () => ({ api: {} }))

import { deliverVisualizationFollowUp } from '../inline-visualization-host'

const payload = {
  text: 'Inspect later',
  thinkingLevel: 'high' as const,
  attachments: [],
}

describe('visualization follow-up delivery', () => {
  it('queues a confirmed follow-up while its active session is streaming', async () => {
    const enqueue = vi.fn(async () => undefined)
    const send = vi.fn(async () => undefined)

    await expect(
      deliverVisualizationFollowUp({ isIdle: false, payload, send, enqueue }),
    ).resolves.toBe(true)
    expect(enqueue).toHaveBeenCalledWith(payload)
    expect(send).not.toHaveBeenCalled()
  })

  // The queued delivery's rejection was dropped and the visualization was told it was delivered
  // (fix(renderer): report a visualization follow-up the queue refused).
  it('reports a follow-up the queue refused as not delivered', async () => {
    const enqueue = vi.fn(async () => {
      throw new Error('Session queue is full')
    })
    const send = vi.fn(async () => undefined)

    await expect(
      deliverVisualizationFollowUp({ isIdle: false, payload, send, enqueue }),
    ).resolves.toBe(false)
  })
})
