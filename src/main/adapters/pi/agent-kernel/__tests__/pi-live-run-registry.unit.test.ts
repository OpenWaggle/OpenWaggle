import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PiModel } from '../../pi-provider-catalog'
import { registerPiLiveRun, steerPiLiveRun } from '../pi-live-run-registry'

describe('Pi live Run registry', () => {
  let unregister: (() => void) | undefined

  afterEach(() => unregister?.())

  it('delivers steering to the exact registered Pi Run', async () => {
    const steer = vi.fn(async () => undefined)
    const session = fromPartial<AgentSession>({ isStreaming: true, steer })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({ runId: 'run-active', session, model })

    const result = await steerPiLiveRun({
      runId: 'run-active',
      text: 'Use the corrected migration order.',
      attachments: [],
    })

    expect(result).toEqual({ accepted: true })
    expect(steer).toHaveBeenCalledWith('Use the corrected migration order.', undefined)
  })
})
