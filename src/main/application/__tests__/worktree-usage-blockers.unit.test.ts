import { describe, expect, it } from 'vitest'
import { workspaceBlocker } from '../worktree-usage-blockers'

type LifecycleState = 'pending' | 'materializing' | 'ready' | 'missing' | 'releasing' | 'failed'

function occupant(lifecycleState: LifecycleState, canonicalWorkingPath = '/wt/feature') {
  return {
    canonicalWorkingPath,
    workspace: {
      id: 'workspace',
      kind: 'managed-worktree' as const,
      workingPath: canonicalWorkingPath,
      lifecycleState,
    },
  }
}

describe('the Workspace state that keeps a worktree from removal', () => {
  it('lets a ready Workspace, or another folder, through', () => {
    expect(workspaceBlocker([occupant('ready')], '/wt/feature')).toBeNull()
    expect(workspaceBlocker([occupant('failed', '/wt/other')], '/wt/feature')).toBeNull()
  })

  it('asks to wait for a change in progress', () => {
    for (const state of ['pending', 'materializing', 'releasing'] as const) {
      expect(workspaceBlocker([occupant(state)], '/wt/feature')?.message).toMatch(/Try again/)
    }
  })

  it('asks for a repair when the Workspace is missing or failed, which lasts', () => {
    expect(workspaceBlocker([occupant('releasing'), occupant('failed')], '/wt/feature')).toEqual({
      kind: 'workspace',
      message:
        'Its Workspace is failed. Repair it from its Session, or hand the Session to another Workspace, first.',
    })
    expect(workspaceBlocker([occupant('missing')], '/wt/feature')?.message).toMatch(/is missing/)
  })
})
