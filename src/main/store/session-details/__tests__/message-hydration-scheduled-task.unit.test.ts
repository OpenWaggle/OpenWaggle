import { describe, expect, it } from 'vitest'
import { hydrateSessionMessage } from '../message-hydration'
import type { SessionNodeRow } from '../types'

function userRow(metadata: object): SessionNodeRow {
  return {
    id: 'user-node',
    session_id: 'session',
    parent_id: null,
    pi_entry_type: 'message',
    kind: 'user_message',
    role: 'user',
    timestamp_ms: 1,
    content_json: JSON.stringify({ parts: [{ type: 'text', text: 'Check CI' }], model: null }),
    metadata_json: JSON.stringify(metadata),
    branch_hint_id: null,
    path_depth: 1,
    created_order: 2,
  }
}

describe('user message hydration', () => {
  it('keeps the Scheduled task the Host recorded as the message origin', () => {
    const scheduledTask = { taskId: 'task-1', name: 'Morning triage', kind: 'heartbeat' }
    const message = hydrateSessionMessage(userRow({ scheduledTask, openWaggle: { runId: 'r' } }))

    expect(message.metadata?.scheduledTask).toEqual(scheduledTask)
  })

  it('has no origin for a message a person typed', () => {
    expect(hydrateSessionMessage(userRow({})).metadata?.scheduledTask).toBeUndefined()
  })
})
