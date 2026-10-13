import type { AgentEndEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'
import { createPiWaggleExtension, type PiWaggleModel } from '../loop.js'

const answer = fromPartial<AgentEndEvent['messages'][number]>({
  role: 'assistant',
  content: [{ type: 'text', text: 'Turn 0 answer' }],
  stopReason: 'stop',
})

it('ends the Waggle when it may not start the next turn, though no Pi run is left to abort', async () => {
  vi.useFakeTimers()
  try {
    const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>()
    const sendMessage = vi.fn()
    let stopped = false
    const extension = createPiWaggleExtension({
      config: {
        mode: 'sequential',
        agents: [
          { label: 'A', model: 'p/a', roleDescription: 'A', color: 'blue' },
          { label: 'B', model: 'p/b', roleDescription: 'B', color: 'amber' },
        ],
        stop: { primary: 'consensus', maxTurnsSafety: 4 },
      },
      createTurnMetadata: () => null,
      // The Stop signal is aborted right after the turn settles, in the gap before the next one.
      onTurnComplete: () => {
        stopped = true
        return { continue: true }
      },
      canStartNextTurn: () => !stopped,
      buildTurnMessage: () => ({ customType: 'turn', content: '', display: false }),
    })
    extension.factory(
      fromPartial<ExtensionAPI>({
        on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
          handlers.set(event, handler)
        },
        sendMessage,
        setModel: async () => true,
      }),
    )
    const ctx = {
      modelRegistry: {
        find: (provider: string, id: string) => fromPartial<PiWaggleModel>({ provider, id }),
      },
    }
    const done = vi.fn()
    void extension.done.then(done)

    await handlers.get('agent_end')?.({ messages: [answer] }, ctx)
    await handlers.get('agent_settled')?.({ type: 'agent_settled', aborted: false }, ctx)
    await vi.runOnlyPendingTimersAsync()

    expect(sendMessage).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})
