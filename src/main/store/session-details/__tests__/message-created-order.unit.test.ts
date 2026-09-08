import { describe, expect, it } from 'vitest'
import { hydrateSessionMessage, hydrateSessionMessages } from '../message-hydration'
import type { SessionNodeRow } from '../types'

function userRow(createdOrder: number): SessionNodeRow {
  return {
    id: 'durable-user',
    session_id: 'session',
    parent_id: null,
    pi_entry_type: 'message',
    kind: 'user_message',
    role: 'user',
    timestamp_ms: 1,
    content_json: JSON.stringify({ parts: [{ type: 'text', text: 'continue' }] }),
    metadata_json: JSON.stringify({
      visualizationSessionId: 'visualization',
      sessionNodeCreatedOrder: 0,
    }),
    branch_hint_id: null,
    path_depth: 1,
    created_order: createdOrder,
  }
}

describe('authoritative message created order', () => {
  it('uses the canonical row order rather than persisted message metadata', () => {
    const row = userRow(42)
    const originalMetadata = row.metadata_json
    expect(hydrateSessionMessage(row).metadata).toMatchObject({
      visualizationSessionId: 'visualization',
      sessionNodeCreatedOrder: 42,
    })
    expect(row.metadata_json).toBe(originalMetadata)
  })

  it('retains Pi order when the visible transcript shrinks after compaction', () => {
    const messages = hydrateSessionMessages([userRow(42)])
    expect(messages).toHaveLength(1)
    expect(messages[0]?.metadata?.sessionNodeCreatedOrder).toBe(42)
  })
})
