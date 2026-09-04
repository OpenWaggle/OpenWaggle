import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setSessionWorktreePlanMock } = vi.hoisted(() => ({
  setSessionWorktreePlanMock: vi.fn(async () => {}),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: { setSessionWorktreePlan: setSessionWorktreePlanMock },
}))

import {
  flushDraftWorktreePlanToSession,
  snapshotDraftWorktreePlan,
  stashDraftWorktreePlan,
} from '../worktree-plan-draft'
import { prepareDraftWorktreePlan, useWorktreePlanStore } from '../worktree-plan-store'

describe('draft worktree plan handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorktreePlanStore.setState({ bySessionId: {} })
  })

  it('keeps the submitted plan stable while session creation is in flight', async () => {
    stashDraftWorktreePlan('/repo', {
      envMode: 'worktree',
      baseRef: 'main',
      startFromOrigin: true,
    })
    const submittedPlan = snapshotDraftWorktreePlan('/repo')

    // The user starts another draft before createSession resolves.
    prepareDraftWorktreePlan('/repo', '/repo')
    expect(snapshotDraftWorktreePlan('/repo')).toBeUndefined()

    await flushDraftWorktreePlanToSession(submittedPlan, SessionId('created-session'))

    expect(setSessionWorktreePlanMock).toHaveBeenCalledWith(SessionId('created-session'), {
      environmentMode: 'worktree',
      baseRef: 'main',
      startFromOrigin: true,
    })
  })
})
