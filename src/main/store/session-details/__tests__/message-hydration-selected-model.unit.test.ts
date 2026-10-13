import { describe, expect, it } from 'vitest'
import { hydrateSessionMessage } from '../message-hydration'
import type { SessionNodeRow } from '../types'

function assistantRow(metadata: object): SessionNodeRow {
  return {
    id: 'assistant-node',
    session_id: 'session',
    parent_id: null,
    pi_entry_type: 'message',
    kind: 'assistant_message',
    role: 'assistant',
    timestamp_ms: 1,
    content_json: JSON.stringify({
      parts: [{ type: 'text', text: 'hi' }],
      model: 'openai/gpt-6-luna',
    }),
    metadata_json: JSON.stringify(metadata),
    branch_hint_id: null,
    path_depth: 1,
    created_order: 2,
  }
}

describe('assistant message hydration', () => {
  it('keeps the selection a virtual model routed the response from', () => {
    const message = hydrateSessionMessage(assistantRow({ selectedModel: 'router/auto' }))

    expect(message.model).toBe('openai/gpt-6-luna')
    expect(message.metadata?.selectedModel).toBe('router/auto')
  })

  it('keeps the error a failed response ended with', () => {
    const message = hydrateSessionMessage(
      assistantRow({ stopReason: 'error', errorMessage: '401 Unauthorized' }),
    )

    expect(message.metadata?.error).toBe('401 Unauthorized')
  })

  it('has no error for a response that finished', () => {
    const message = hydrateSessionMessage(assistantRow({ stopReason: 'stop', errorMessage: null }))

    expect(message.metadata?.error).toBeUndefined()
  })
})
