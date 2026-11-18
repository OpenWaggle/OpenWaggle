import { SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import { createSessionListener } from '../session-listener'

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function messageEnd(stopReason: 'error' | 'stop', errorMessage?: string) {
  const emitted: AgentTransportEvent[] = []
  const listener = createSessionListener(
    {
      model: SupportedModelId('openai/gpt-5.4'),
      sessionEntries: null,
      onEvent: (event) => emitted.push(event),
    },
    'run-1',
  )
  const message = {
    role: 'assistant' as const,
    content: [],
    api: 'openai-responses' as const,
    provider: 'openai',
    model: 'gpt-5.4',
    usage,
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: 1,
  }
  listener({ type: 'message_start', message })
  listener({ type: 'message_end', message })
  return emitted.find((event) => event.type === 'message_end')
}

describe('createSessionListener message_end', () => {
  it('carries the error a failed response ended with', () => {
    expect(messageEnd('error', '401 Unauthorized')).toMatchObject({
      type: 'message_end',
      errorMessage: '401 Unauthorized',
    })
  })

  it('carries no error for a response that finished', () => {
    expect(messageEnd('stop')).not.toHaveProperty('errorMessage')
  })
})
