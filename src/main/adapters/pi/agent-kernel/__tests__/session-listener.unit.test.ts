import { SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import { createSessionListener } from '../session-listener'

const usage = {
  input: 42,
  output: 8,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 50,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

describe('createSessionListener Pi compatibility', () => {
  it('marks retrying failures as provisional and a stopped retry as cancelled', () => {
    const emitted: AgentTransportEvent[] = []
    const listener = createSessionListener(
      {
        model: SupportedModelId('spark/GLM-5.3-Flash-EXL3'),
        onEvent: (event) => emitted.push(event),
      },
      'run-1',
    )

    listener({
      type: 'agent_end',
      willRetry: true,
      messages: [
        {
          role: 'assistant',
          content: [],
          api: 'openai-completions',
          provider: 'spark',
          model: 'GLM-5.3-Flash-EXL3',
          usage,
          stopReason: 'error',
          errorMessage: 'terminated',
          timestamp: 1,
        },
      ],
    })
    listener({ type: 'auto_retry_end', success: false, attempt: 1, finalError: 'Retry cancelled' })

    expect(emitted).toMatchObject([
      { type: 'agent_end', reason: 'error', willRetry: true },
      { type: 'auto_retry_end', success: false, attempt: 1, cancelled: true },
    ])
    expect(emitted[1]).not.toHaveProperty('finalError')
  })

  it('does not duplicate Pi settlement or extension-entry persistence as transport events', () => {
    const emitted: AgentTransportEvent[] = []
    const listener = createSessionListener(
      {
        model: SupportedModelId('openai/gpt-5.4'),
        onEvent: (event) => emitted.push(event),
      },
      'run-1',
    )

    listener({ type: 'agent_settled' })
    listener({
      type: 'entry_appended',
      entry: {
        type: 'custom',
        id: 'entry-1',
        parentId: null,
        timestamp: '2026-07-13T00:00:00.000Z',
        customType: 'openwaggle.test',
        data: { persisted: true },
      },
    })

    expect(emitted).toEqual([])
  })

  it('emits authoritative context usage after each completed assistant response', () => {
    const emitted: AgentTransportEvent[] = []
    const listener = createSessionListener(
      {
        model: SupportedModelId('openai/gpt-5.4'),
        getContextWindow: (provider, model) =>
          provider === 'openai' && model === 'gpt-5.4' ? 100_000 : undefined,
        onEvent: (event) => emitted.push(event),
      },
      'run-1',
    )
    const message = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Calling a tool next.' }],
      api: 'openai-responses' as const,
      provider: 'openai',
      model: 'gpt-5.4',
      usage,
      stopReason: 'toolUse' as const,
      timestamp: 1,
    }

    listener({ type: 'message_start', message })
    listener({ type: 'message_end', message })

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: 'context_usage',
        tokens: 50,
        contextWindow: 100_000,
        model: 'openai/gpt-5.4',
      }),
    )
  })

  it.each(['error', 'aborted'] as const)(
    'does not replace valid context usage after a %s response',
    (stopReason) => {
      const emitted: AgentTransportEvent[] = []
      const listener = createSessionListener(
        {
          model: SupportedModelId('openai/gpt-5.4'),
          getContextWindow: () => 100_000,
          onEvent: (event) => emitted.push(event),
        },
        'run-1',
      )
      const message = {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: '' }],
        api: 'openai-responses' as const,
        provider: 'openai',
        model: 'gpt-5.4',
        usage,
        stopReason,
        timestamp: 1,
      }

      listener({ type: 'message_start', message })
      listener({ type: 'message_end', message })

      expect(emitted).not.toContainEqual(expect.objectContaining({ type: 'context_usage' }))
    },
  )

  it('does not publish an initialized all-zero usage object', () => {
    const emitted: AgentTransportEvent[] = []
    const listener = createSessionListener(
      {
        model: SupportedModelId('openai/gpt-5.4'),
        getContextWindow: () => 100_000,
        onEvent: (event) => emitted.push(event),
      },
      'run-1',
    )
    const message = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: '' }],
      api: 'openai-responses' as const,
      provider: 'openai',
      model: 'gpt-5.4',
      usage: {
        ...usage,
        input: 0,
        output: 0,
        totalTokens: 0,
      },
      stopReason: 'stop' as const,
      timestamp: 1,
    }

    listener({ type: 'message_start', message })
    listener({ type: 'message_end', message })

    expect(emitted).not.toContainEqual(expect.objectContaining({ type: 'context_usage' }))
  })

  it('keeps response identity and context window atomic across a model switch', () => {
    const emitted: AgentTransportEvent[] = []
    const listener = createSessionListener(
      {
        model: SupportedModelId('openai/gpt-5.4'),
        getContextWindow: (provider, model) =>
          provider === 'anthropic' && model === 'claude-sonnet-4-6' ? 1_000_000 : undefined,
        onEvent: (event) => emitted.push(event),
      },
      'run-1',
    )
    const message = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Completed by the switched model.' }],
      api: 'anthropic-messages' as const,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      usage,
      stopReason: 'stop' as const,
      timestamp: 1,
    }

    listener({ type: 'message_start', message })
    listener({ type: 'message_end', message })

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: 'context_usage',
        model: 'anthropic/claude-sonnet-4-6',
        contextWindow: 1_000_000,
      }),
    )
  })
})
