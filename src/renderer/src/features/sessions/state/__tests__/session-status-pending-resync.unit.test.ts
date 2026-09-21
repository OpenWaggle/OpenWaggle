import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/ipc', () => ({ api: {} }))

import { useSessionStatusStore } from '../session-status-store'

const SESSION_ID = SessionId('session-pending-resync')

function summary(input: {
  readonly pendingInteractionAt?: number
  readonly pendingInteractionSnapshotAt: number
}): SessionSummary {
  return {
    id: SESSION_ID,
    title: 'Pending Session',
    projectPath: '/repo',
    createdAt: 1,
    updatedAt: 100,
    latestRun: { status: 'active', updatedAt: 100 },
    ...input,
  }
}

describe('pending-interaction status resync', () => {
  beforeEach(() => {
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      statusUpdatedAt: new Map(),
      lastVisitedAt: new Map(),
      phases: new Map(),
    })
  })

  it('clears Awaiting input when a newer Host snapshot has no pending interaction', () => {
    const store = useSessionStatusStore.getState()
    store.hydratePersistedStatuses([
      summary({ pendingInteractionAt: 120, pendingInteractionSnapshotAt: 130 }),
    ])
    expect(store.getStatus(SESSION_ID)).toBe('awaiting-input')

    store.hydratePersistedStatuses([summary({ pendingInteractionSnapshotAt: 160 })])

    expect(store.getStatus(SESSION_ID)).toBe('working')
    expect(useSessionStatusStore.getState().statusUpdatedAt.get(SESSION_ID)).toBe(160)
  })

  it('does not let an older empty snapshot clear a newer pending event', () => {
    const store = useSessionStatusStore.getState()
    store.setStatus(SESSION_ID, 'awaiting-input', 140)

    store.hydratePersistedStatuses([summary({ pendingInteractionSnapshotAt: 130 })])

    expect(store.getStatus(SESSION_ID)).toBe('awaiting-input')
    expect(useSessionStatusStore.getState().statusUpdatedAt.get(SESSION_ID)).toBe(140)
  })

  it('does not let a settled snapshot replace a newer live event', () => {
    const store = useSessionStatusStore.getState()
    store.hydratePersistedStatuses([
      summary({ pendingInteractionAt: 120, pendingInteractionSnapshotAt: 130 }),
    ])
    store.setStatus(SESSION_ID, 'working', 180)

    store.hydratePersistedStatuses([summary({ pendingInteractionSnapshotAt: 160 })])

    expect(store.getStatus(SESSION_ID)).toBe('working')
    expect(useSessionStatusStore.getState().statusUpdatedAt.get(SESSION_ID)).toBe(180)
  })
})
