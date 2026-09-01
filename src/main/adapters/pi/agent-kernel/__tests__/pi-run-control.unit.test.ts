import { describe, expect, it, vi } from 'vitest'
import { createPiRunControl } from '../pi-run-control'
import { payload } from './run-orchestration.test-utils'

describe('Pi native run control', () => {
  it('delivers steering through the live Pi session', async () => {
    const session = {
      sendCustomMessage: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => undefined),
    }
    const control = createPiRunControl(session, { input: ['text', 'image'] })

    await control.steer(payload('Take the safer path'))

    expect(session.sendUserMessage).toHaveBeenCalledWith('Take the safer path', {
      deliverAs: 'steer',
    })
  })
})
