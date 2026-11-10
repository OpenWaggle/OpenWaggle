import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { activeSessionRunningWorkerCount } from '../active-session-running-workers'

function queen(runningWorkerCount: number): SessionSummary {
  return {
    id: SessionId('queen'),
    title: 'Queen',
    projectPath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    lineage: {
      role: 'queen',
      directWorkerCount: 2,
      activeDirectWorkerCount: 2,
      runningWorkerCount,
    },
  }
}

describe('activeSessionRunningWorkerCount (ADR 0065)', () => {
  it('prefers the catalog entry, which follows Worker Runs, over the open tree', () => {
    expect(
      activeSessionRunningWorkerCount({
        activeSessionId: SessionId('queen'),
        sessions: [queen(0)],
        archivedSessions: [],
        treeSession: queen(2),
      }),
    ).toBe(0)
  })

  it('falls back to the archived catalog, then the open tree', () => {
    expect(
      activeSessionRunningWorkerCount({
        activeSessionId: SessionId('queen'),
        sessions: [],
        archivedSessions: [queen(1)],
        treeSession: queen(2),
      }),
    ).toBe(1)
    expect(
      activeSessionRunningWorkerCount({
        activeSessionId: SessionId('queen'),
        sessions: [],
        archivedSessions: [],
        treeSession: queen(2),
      }),
    ).toBe(2)
    expect(
      activeSessionRunningWorkerCount({
        activeSessionId: SessionId('other'),
        sessions: [],
        archivedSessions: [],
        treeSession: queen(2),
      }),
    ).toBe(0)
  })
})
