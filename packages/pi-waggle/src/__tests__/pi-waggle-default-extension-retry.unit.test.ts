import type { AgentEndEvent } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import {
  assistantTextMessage,
  createHarness,
  modelFor,
} from './pi-waggle-default-extension.test-support'

function failedResponse(errorMessage: string) {
  return fromPartial<AgentEndEvent['messages'][number]>({
    role: 'assistant',
    content: [],
    stopReason: 'error',
    errorMessage,
  })
}

async function startedRun() {
  const harness = createHarness()
  const waggleCommand = harness.commands.get('waggle')
  if (!waggleCommand) throw new Error('Expected /waggle command to be registered')
  await waggleCommand.handler('code-review Review this migration', harness.ctx)
  harness.setModel.mockClear()
  harness.sendMessage.mockClear()
  harness.sendUserMessage.mockClear()
  return harness
}

describe('the default extension when a turn fails', () => {
  it('waits for the attempt Pi retries and advances once the retry settles', async () => {
    const harness = await startedRun()
    const agentEnd = harness.eventHandlers.get('agent_end')
    if (!agentEnd) throw new Error('Expected agent_end handler')
    vi.useFakeTimers()
    try {
      await agentEnd(
        { type: 'agent_end', messages: [failedResponse('503 Service Unavailable')] },
        harness.ctx,
      )
      await vi.runOnlyPendingTimersAsync()

      expect(harness.setModel).not.toHaveBeenCalled()
      expect(harness.sendUserMessage).not.toHaveBeenCalled()

      await harness.settle([assistantTextMessage('Retried answer.')])
      await vi.runOnlyPendingTimersAsync()

      expect(harness.setModel).toHaveBeenCalledOnce()
      expect(harness.sendUserMessage).toHaveBeenLastCalledWith(
        'Continue Waggle turn 2 as Reviewer.',
        { deliverAs: 'followUp' },
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops the collaboration on an error no later turn can recover from', async () => {
    const harness = await startedRun()
    vi.useFakeTimers()
    try {
      await harness.settle([failedResponse('401 Unauthorized: Incorrect API key provided')])
      await vi.runOnlyPendingTimersAsync()

      expect(harness.sendMessage).not.toHaveBeenCalled()
      expect(harness.sendUserMessage).not.toHaveBeenCalled()
      expect(harness.setModel).toHaveBeenCalledWith(modelFor('openai/gpt-5.5'))
      expect(harness.ctx.ui.notify).toHaveBeenCalledWith(
        'Waggle stopped because Architect failed: 401 Unauthorized: Incorrect API key provided',
        'warning',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('ends the Waggle when the user aborts its turn', async () => {
    const harness = await startedRun()
    vi.useFakeTimers()
    try {
      await harness.abort([
        fromPartial<AgentEndEvent['messages'][number]>({
          role: 'assistant',
          content: [],
          stopReason: 'aborted',
        }),
      ])
      await vi.runOnlyPendingTimersAsync()

      expect(harness.sendMessage).not.toHaveBeenCalled()
      expect(harness.sendUserMessage).not.toHaveBeenCalled()
      expect(harness.setModel).toHaveBeenCalledWith(modelFor('openai/gpt-5.5'))
      expect(harness.ctx.ui.notify).toHaveBeenCalledWith(
        'Waggle stopped because the turn was aborted.',
        'warning',
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
