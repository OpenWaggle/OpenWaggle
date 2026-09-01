import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { withRunCompactionStatus } from '../background-run-render-state'

const SESSION_ID = SessionId('session-manual-compaction')
const SNAPSHOT = {
  messages: [
    {
      id: 'user-1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, content: 'Existing transcript' }],
      createdAt: new Date(1),
    },
  ],
  compactionStatus: null,
  updatedAt: 1,
}

function state() {
  return { renderSnapshotsBySessionId: new Map([[SESSION_ID, SNAPSHOT]]) }
}

describe('background run render state', () => {
  it('releases an inactive snapshot after durable compaction acknowledgement', () => {
    const next = withRunCompactionStatus(state(), SESSION_ID, null, false)

    expect(next.renderSnapshotsBySessionId.has(SESSION_ID)).toBe(false)
  })

  it('retains a render snapshot while its agent run is active', () => {
    const next = withRunCompactionStatus(state(), SESSION_ID, null, true)

    expect(next.renderSnapshotsBySessionId.get(SESSION_ID)?.messages).toEqual(SNAPSHOT.messages)
  })
})
