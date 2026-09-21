import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/ipc', () => ({ api: {} }))

import { useSessionStatusStore } from '../session-status-store'

const SESSION_ID = SessionId('session-a')

function summary(status: NonNullable<SessionSummary['latestRun']>['status'], updatedAt: number) {
  return {
    id: SESSION_ID,
    title: 'Session A',
    projectPath: '/repo',
    createdAt: 1,
    updatedAt,
    latestRun: { status, updatedAt },
  } satisfies SessionSummary
}

describe('synthetic Run completion reconciliation', () => {
  beforeEach(() => {
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      statusUpdatedAt: new Map(),
      lastVisitedAt: new Map(),
      phases: new Map(),
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it.each([
    { durableStatus: 'failed' as const, expectedStatus: 'error' as const },
    { durableStatus: 'interrupted' as const, expectedStatus: 'idle' as const },
  ])(
    'reconciles a synthetic completion with a durable $durableStatus Run',
    ({ durableStatus, expectedStatus }) => {
      vi.spyOn(Date, 'now').mockReturnValue(300)
      useSessionStatusStore.getState().setStatus(SESSION_ID, 'working', 100)
      useSessionStatusStore.getState().markRunCompleted(SESSION_ID)

      expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('completed')
      expect(useSessionStatusStore.getState().completedAt.get(SESSION_ID)).toBe(300)

      useSessionStatusStore.getState().hydratePersistedStatuses([summary('completed', 50)])
      expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('completed')

      useSessionStatusStore.getState().hydratePersistedStatuses([summary(durableStatus, 200)])

      expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe(expectedStatus)
      expect(useSessionStatusStore.getState().completedAt.get(SESSION_ID)).toBe(
        expectedStatus === 'error' ? 200 : undefined,
      )
    },
  )

  it('does not replace an observed error with a synthetic completion', () => {
    useSessionStatusStore.getState().setStatus(SESSION_ID, 'error', 200)

    useSessionStatusStore.getState().markRunCompleted(SESSION_ID)

    expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('error')
    expect(useSessionStatusStore.getState().completedAt.get(SESSION_ID)).toBe(200)
  })

  it('does not promote a timestamp-less Waggle signal above the durable Run clock', () => {
    vi.spyOn(Date, 'now').mockReturnValue(300)
    useSessionStatusStore.getState().setStatus(SESSION_ID, 'working', 100)

    useSessionStatusStore.getState().markWaggleRunning(SESSION_ID)
    expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('waggle-running')
    expect(useSessionStatusStore.getState().statusUpdatedAt.get(SESSION_ID)).toBe(100)

    useSessionStatusStore.getState().hydratePersistedStatuses([summary('failed', 200)])
    expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('error')
  })
})
