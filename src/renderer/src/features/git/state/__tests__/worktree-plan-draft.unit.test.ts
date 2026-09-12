import { beforeEach, describe, expect, it } from 'vitest'

import { snapshotDraftWorktreePlan, stashDraftWorktreePlan } from '../worktree-plan-draft'
import { prepareDraftWorktreePlan, useWorktreePlanStore } from '../worktree-plan-store'

describe('draft worktree plan handoff', () => {
  beforeEach(() => {
    useWorktreePlanStore.setState({ bySessionId: {} })
  })

  it('keeps the submitted plan stable while session creation is in flight', () => {
    stashDraftWorktreePlan('/repo', {
      envMode: 'worktree',
      baseRef: 'main',
      startFromOrigin: true,
    })
    const submittedPlan = snapshotDraftWorktreePlan('/repo')

    // The user starts another draft before createSession resolves.
    prepareDraftWorktreePlan('/repo', '/repo')
    expect(snapshotDraftWorktreePlan('/repo')).toBeUndefined()

    expect(submittedPlan).toEqual({
      projectPath: '/repo',
      plan: { envMode: 'worktree', baseRef: 'main', startFromOrigin: true },
    })
  })
})
