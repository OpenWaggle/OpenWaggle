import { describe, expect, it } from 'vitest'
import { hydrateSessionMessage } from '../message-hydration'
import type { SessionNodeRow } from '../types'

const nestedCalls = {
  complete: true,
  calls: [
    { id: 'code-1/1', name: 'read', args: { path: 'a.ts' }, status: 'ok', durationMs: 3 },
    { id: 'code-1/2', name: 'write', argsBytes: 90_000, status: 'error', error: 'denied' },
  ],
}

function toolResultRow(): SessionNodeRow {
  return {
    id: 'tool-result-node',
    session_id: 'session',
    parent_id: null,
    pi_entry_type: 'message',
    kind: 'tool_result',
    role: null,
    timestamp_ms: 1,
    content_json: JSON.stringify({
      parts: [
        {
          type: 'tool-result',
          toolResult: {
            id: 'code-1',
            name: 'codemode',
            args: {},
            result: 'done',
            isError: false,
            duration: 0,
            nestedCalls,
          },
        },
      ],
      model: null,
    }),
    metadata_json: '{}',
    branch_hint_id: null,
    path_depth: 1,
    created_order: 3,
  }
}

describe('tool result hydration', () => {
  it('keeps the nested calls Pi recorded on a persisted tool result', () => {
    expect(hydrateSessionMessage(toolResultRow()).parts).toEqual([
      {
        type: 'tool-result',
        toolResult: expect.objectContaining({ id: 'code-1', nestedCalls }),
      },
    ])
  })
})
