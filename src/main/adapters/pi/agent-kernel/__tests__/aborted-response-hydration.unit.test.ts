import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import type { SessionNodeRow } from '../../../../store/session-details'
import { buildSessionNodes } from '../../../../store/sessions/node-hydration'
import { projectionForPiEntry } from '../entry-projections'

const abortedEmptyResponse = {
  type: 'message',
  id: 'aborted',
  parentId: 'prompt',
  timestamp: '2026-10-25T10:00:00.000Z',
  message: {
    role: 'assistant',
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    content: [],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'aborted',
    timestamp: 1,
  },
} satisfies SessionEntry

function row(overrides: Partial<SessionNodeRow> & Pick<SessionNodeRow, 'id'>): SessionNodeRow {
  return {
    session_id: 'session-1',
    parent_id: null,
    pi_entry_type: 'message',
    kind: 'user_message',
    role: 'user',
    timestamp_ms: 1,
    content_json: '{"parts":[{"type":"text","text":"Go"}]}',
    metadata_json: '{}',
    branch_hint_id: null,
    path_depth: 0,
    created_order: 1,
    ...overrides,
  }
}

describe('an interrupted response that streamed nothing', () => {
  it('hydrates into a node with no message, like other raw Pi entries', () => {
    const projection = projectionForPiEntry(abortedEmptyResponse)
    const nodes = buildSessionNodes([
      row({ id: 'prompt' }),
      row({
        id: 'aborted',
        parent_id: 'prompt',
        kind: projection.kind,
        role: projection.role,
        content_json: projection.contentJson,
        metadata_json: projection.metadataJson,
        created_order: 2,
      }),
      row({ id: 'next-prompt', parent_id: 'aborted', created_order: 3 }),
    ])

    expect(nodes.map((node) => [node.id, node.message === undefined])).toEqual([
      ['prompt', false],
      ['aborted', true],
      ['next-prompt', false],
    ])
  })
})
