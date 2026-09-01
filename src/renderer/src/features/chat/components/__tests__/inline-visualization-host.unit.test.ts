import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/ipc', () => ({ api: {} }))

import { deliverVisualizationFollowUp } from '../inline-visualization-host'

describe('visualization follow-up delivery', () => {
  it('queues a confirmed follow-up while its active session is streaming', async () => {
    const payload = {
      text: 'Inspect later',
      thinkingLevel: 'high' as const,
      attachments: [],
    }
    const enqueue = vi.fn()
    const send = vi.fn(async () => undefined)

    await expect(
      deliverVisualizationFollowUp({ isIdle: false, payload, send, enqueue }),
    ).resolves.toBe(true)
    expect(enqueue).toHaveBeenCalledWith(payload)
    expect(send).not.toHaveBeenCalled()
  })
})
