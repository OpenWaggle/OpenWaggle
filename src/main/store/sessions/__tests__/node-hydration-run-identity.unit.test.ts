import { OPENWAGGLE_RUN_IDENTITY_CUSTOM_TYPE } from '@shared/constants/run-identity'
import { describe, expect, it } from 'vitest'
import type { SessionNodeRow } from '../../session-details'
import { buildSessionNodes } from '../node-hydration'

function row(overrides: Partial<SessionNodeRow> & Pick<SessionNodeRow, 'id'>): SessionNodeRow {
  return {
    session_id: 'session-1',
    parent_id: null,
    pi_entry_type: 'message',
    kind: 'user_message',
    role: 'user',
    timestamp_ms: 1,
    content_json: '{"parts":[]}',
    metadata_json: '{}',
    branch_hint_id: null,
    path_depth: 0,
    created_order: 1,
    ...overrides,
  }
}

describe('the stored Run identity in the Session tree', () => {
  it('is hidden, and the Run prompt after it hangs from the previous visible node', () => {
    const nodes = buildSessionNodes([
      row({ id: 'answer-1', kind: 'assistant_message', role: 'assistant' }),
      row({
        id: 'identity-2',
        parent_id: 'answer-1',
        pi_entry_type: 'custom',
        kind: 'custom',
        role: null,
        content_json: JSON.stringify({
          customType: OPENWAGGLE_RUN_IDENTITY_CUSTOM_TYPE,
          data: { content: 'run-2' },
        }),
        created_order: 2,
      }),
      row({ id: 'prompt-2', parent_id: 'identity-2', created_order: 3 }),
    ])

    expect(nodes.map((node) => node.id)).toEqual(['answer-1', 'prompt-2'])
    expect(nodes[1]?.parentId).toBe('answer-1')
  })
})
