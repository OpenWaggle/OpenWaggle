import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PiModel } from '../../pi-provider-catalog'
import { registerPiLiveRun, steerPiLiveRun } from '../pi-live-run-registry'

describe('Pi live Run registry', () => {
  let unregister: (() => void) | undefined

  afterEach(() => unregister?.())

  it('delivers steering to the exact registered Pi Run', async () => {
    const steer = vi.fn(async (_text: string) => undefined)
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

  it('wraps untrusted visualization state into the exact steering message', async () => {
    const steer = vi.fn(async (_text: string) => undefined)
    const session = fromPartial<AgentSession>({ isStreaming: true, steer })
    const model = fromPartial<PiModel>({ input: ['text'] })
    unregister = registerPiLiveRun({ runId: 'run-visualization', session, model })

    await steerPiLiveRun({
      runId: 'run-visualization',
      text: 'Explain this selection.',
      attachments: [],
      visualizationContext: {
        title: 'Service map',
        sourcePath: '/repo/service-map.html',
        state: { selectedService: 'api' },
      },
    })

    const steeringText = steer.mock.calls[0]?.[0]
    expect(steeringText).toContain('[OpenWaggle inline visualization context]')
    expect(steeringText).toContain('untrusted data')
    expect(steeringText).toContain('"selectedService":"api"')
    expect(steeringText).toContain('Explain this selection.')
  })
})
