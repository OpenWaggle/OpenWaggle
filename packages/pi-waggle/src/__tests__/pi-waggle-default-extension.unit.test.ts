import type { AgentEndEvent } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'
import {
  assistantTextMessage,
  assistantToolCallMessage,
  createHarness,
  enabledModeStateEntry,
  inputImage,
  toolResultMessage,
} from './pi-waggle-default-extension.test-support'

describe('pi-waggle default extension runtime flow', () => {
  it('registers the terminating Waggle invocation tool for standard agents', () => {
    const harness = createHarness()
    const tool = harness.tools.get('waggle_invoke')

    expect(tool).toMatchObject({
      name: 'waggle_invoke',
      label: 'Invoke Waggle',
      executionMode: 'sequential',
    })
    expect(tool?.promptGuidelines).toEqual(
      expect.arrayContaining([expect.stringContaining('only tool in its batch')]),
    )
  })

  it('resolves a preset and returns a visible terminating handoff request', async () => {
    const harness = createHarness()
    const tool = harness.tools.get('waggle_invoke')
    if (!tool) throw new Error('Expected waggle_invoke tool')

    const result = await tool.execute(
      'tool-call-1',
      { preset: 'code-review', prompt: 'Review the current changes.' },
      undefined,
      undefined,
      harness.ctx,
    )

    expect(result).toMatchObject({
      terminate: true,
      details: {
        kind: 'waggle-handoff',
        presetId: 'code-review',
        presetName: 'Code Review',
        source: 'agent',
        prompt: 'Review the current changes.',
      },
    })
  })

  it('preserves original image context when rewriting automatic Waggle turns', async () => {
    const image = inputImage()
    const harness = createHarness({ branchEntries: [enabledModeStateEntry()] })
    const input = harness.eventHandlers.get('input')
    const context = harness.eventHandlers.get('context')
    if (!input) throw new Error('Expected input handler')
    if (!context) throw new Error('Expected context handler')

    const inputResult = await input(
      { type: 'input', source: 'interactive', text: 'Inspect this screenshot', images: [image] },
      harness.ctx,
    )
    const contextResult = context(
      {
        type: 'context',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Inspect this screenshot' }, image],
          },
        ],
      },
      harness.ctx,
    )

    expect(inputResult).toEqual({ action: 'continue' })
    expect(contextResult).toEqual({
      messages: [
        {
          role: 'user',
          content: [
            expect.objectContaining({
              type: 'text',
              text: expect.stringContaining('Inspect this screenshot'),
            }),
            image,
          ],
        },
      ],
    })
  })

  it.each(['stop waggle and give me a summary', '/skill:review-pr'])(
    'stops an active Waggle run and returns %s to Pi for canonical steering',
    async (steeringText) => {
      const harness = createHarness()
      const waggleCommand = harness.commands.get('waggle')
      const input = harness.eventHandlers.get('input')
      if (!waggleCommand) throw new Error('Expected /waggle command to be registered')
      if (!input) throw new Error('Expected input handler')

      await waggleCommand.handler('code-review Review this migration', harness.ctx)
      harness.sendUserMessage.mockClear()

      const result = await input(
        { type: 'input', source: 'interactive', text: steeringText },
        harness.ctx,
      )

      expect(result).toEqual({
        action: 'transform',
        text: steeringText,
        images: undefined,
      })
      expect(harness.sendUserMessage).not.toHaveBeenCalled()
      expect(harness.ctx.ui.setStatus).toHaveBeenLastCalledWith('pi-waggle', undefined)

      harness.sendMessage.mockClear()
      harness.sendUserMessage.mockClear()
      vi.useFakeTimers()
      try {
        await harness.settle([assistantTextMessage('Stopped with summary.')])
        await vi.runOnlyPendingTimersAsync()
        expect(harness.sendMessage).not.toHaveBeenCalled()
        expect(harness.sendUserMessage).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it('waits for a tool-using Pi run to settle before scheduling the next Waggle turn', async () => {
    const harness = createHarness()
    const waggleCommand = harness.commands.get('waggle')
    const agentEnd = harness.eventHandlers.get('agent_end')
    const agentSettled = harness.eventHandlers.get('agent_settled')
    if (!waggleCommand) throw new Error('Expected /waggle command to be registered')
    if (!agentEnd || !agentSettled) throw new Error('Expected agent_end and agent_settled handlers')

    await waggleCommand.handler('code-review Review this migration', harness.ctx)
    harness.sendMessage.mockClear()
    harness.sendUserMessage.mockClear()

    vi.useFakeTimers()
    try {
      const messages: AgentEndEvent['messages'] = [
        assistantToolCallMessage('tool-1'),
        toolResultMessage('tool-1'),
        assistantTextMessage('Done after reading.'),
      ]
      await agentEnd({ type: 'agent_end', messages }, harness.ctx)
      await vi.runOnlyPendingTimersAsync()

      expect(harness.sendMessage).not.toHaveBeenCalled()
      expect(harness.sendUserMessage).not.toHaveBeenCalled()

      await agentSettled({ type: 'agent_settled', aborted: false }, harness.ctx)
      await vi.runOnlyPendingTimersAsync()

      expect(harness.sendMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ customType: 'pi-waggle.turn', display: true }),
        { triggerTurn: false },
      )
      expect(harness.sendUserMessage).toHaveBeenLastCalledWith(
        'Continue Waggle turn 2 as Reviewer.',
        { deliverAs: 'followUp' },
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
