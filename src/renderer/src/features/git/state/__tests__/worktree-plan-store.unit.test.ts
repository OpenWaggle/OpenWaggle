import { beforeEach, describe, expect, it } from 'vitest'
import {
  draftWorktreePlanKey,
  PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY,
  prepareDraftWorktreePlan,
  useWorktreePlanStore,
} from '../worktree-plan-store'

describe('prepareDraftWorktreePlan', () => {
  beforeEach(() => {
    useWorktreePlanStore.setState({ bySessionId: {} })
  })

  it('adopts a projectless choice and replaces an older project draft', () => {
    const store = useWorktreePlanStore.getState()
    store.setOverride(PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY, { envMode: 'worktree' })
    store.setOverride(draftWorktreePlanKey('/repo'), {
      envMode: 'local',
      baseRef: 'stale-branch',
    })

    prepareDraftWorktreePlan(null, '/repo')

    expect(useWorktreePlanStore.getState().bySessionId).toEqual({
      [PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY]: { envMode: 'worktree' },
      [draftWorktreePlanKey('/repo')]: { envMode: 'worktree' },
    })
  })

  it('clears temporary choices when a no-project draft is abandoned', () => {
    useWorktreePlanStore
      .getState()
      .setOverride(PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY, { envMode: 'worktree' })

    prepareDraftWorktreePlan(null, null)

    expect(useWorktreePlanStore.getState().bySessionId).toEqual({})
  })

  it('starts a later project draft from defaults', () => {
    const store = useWorktreePlanStore.getState()
    store.setOverride(PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY, { envMode: 'worktree' })
    store.setOverride(draftWorktreePlanKey('/old'), { baseRef: 'old-branch' })
    store.setOverride(draftWorktreePlanKey('/next'), { baseRef: 'stale-next-branch' })

    prepareDraftWorktreePlan('/old', '/next')

    expect(useWorktreePlanStore.getState().bySessionId).toEqual({})
  })
})
