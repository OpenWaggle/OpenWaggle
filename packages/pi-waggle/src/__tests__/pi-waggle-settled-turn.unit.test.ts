import type { AgentEndEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'
import {
  createPiWaggleExtension,
  onPiWaggleSettledAgentEnd,
  type PiWaggleTurnCompleteInput,
} from '../loop.js'

type Message = AgentEndEvent['messages'][number]

const toolCall = fromPartial<Message>({
  role: 'assistant',
  content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: {} }],
  stopReason: 'toolUse',
})
const toolResult = fromPartial<Message>({
  role: 'toolResult',
  toolCallId: 'call-1',
  toolName: 'read',
  content: [{ type: 'text', text: 'ok' }],
})
const failedAttempt = fromPartial<Message>({
  role: 'assistant',
  content: [],
  stopReason: 'error',
  errorMessage: '503 Service Unavailable',
})
const answer = fromPartial<Message>({
  role: 'assistant',
  content: [{ type: 'text', text: 'Answer after the retry' }],
  stopReason: 'stop',
})

function settledTurnHarness() {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>()
  const onTurnComplete = vi.fn((_input: PiWaggleTurnCompleteInput<null>) => ({ continue: false }))
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
    onTurnComplete,
    buildTurnMessage: () => ({ customType: 'turn', content: '', display: false }),
  })
  extension.factory(
    fromPartial<ExtensionAPI>({
      on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        handlers.set(event, handler)
      },
    }),
  )
  const ctx = { modelRegistry: { find: () => undefined } }
  return {
    done: extension.done,
    onTurnComplete,
    end: (messages: readonly Message[]) => handlers.get('agent_end')?.({ messages }, ctx),
    settle: (aborted = false) =>
      handlers.get('agent_settled')?.({ type: 'agent_settled', aborted }, ctx),
  }
}

it("judges a turn by all of its run's messages but the attempt Pi retried", async () => {
  const { onTurnComplete, end, settle } = settledTurnHarness()

  // A retry after a tool call: Pi ends the failed attempt's run, then the retry's run, which
  // carries only its own messages.
  await end([toolCall, toolResult, failedAttempt])
  await end([answer])
  expect(onTurnComplete).not.toHaveBeenCalled()
  await settle()

  expect(onTurnComplete).toHaveBeenCalledOnce()
  expect(onTurnComplete.mock.calls[0]?.[0].messages).toEqual([toolCall, toolResult, answer])
})

it('ends the Waggle with a run the user aborted, without judging its turn', async () => {
  const { done, onTurnComplete, end, settle } = settledTurnHarness()

  // Escape: Pi settles the run as aborted.
  await end([toolCall, toolResult])
  await settle(true)

  expect(onTurnComplete).not.toHaveBeenCalled()
  await expect(done).resolves.toBeUndefined()

  // A later run is not a turn of the ended Waggle.
  await end([answer])
  await settle()
  expect(onTurnComplete).not.toHaveBeenCalled()
})

it('does not carry an aborted run’s messages into a later turn', async () => {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>()
  const turns: (readonly Message[])[] = []
  onPiWaggleSettledAgentEnd(
    fromPartial<ExtensionAPI>({
      on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        handlers.set(event, handler)
      },
    }),
    (event) => {
      turns.push(event.messages)
    },
  )

  await handlers.get('agent_end')?.({ messages: [toolCall, toolResult] }, {})
  await handlers.get('agent_settled')?.({ type: 'agent_settled', aborted: true }, {})
  await handlers.get('agent_end')?.({ messages: [answer] }, {})
  await handlers.get('agent_settled')?.({ type: 'agent_settled', aborted: false }, {})

  expect(turns).toEqual([[answer]])
})
