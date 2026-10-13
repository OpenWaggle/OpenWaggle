import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import type { HiveDelegationState } from '@/queries/session-hive-contract'
import type { SidebarRowState } from '../sidebar-row-state'
import { workerAttentionByQueen } from '../worker-attention'

function worker(
  id: string,
  delegationState: HiveDelegationState,
  extra: { readonly archived?: boolean } = {},
): SessionSummary {
  return {
    id: SessionId(id),
    title: id,
    projectPath: '/project',
    createdAt: 1,
    updatedAt: 1,
    ...extra,
    lineage: {
      role: 'worker',
      parentSessionId: SessionId('parent'),
      hiveRootSessionId: SessionId('queen'),
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      delegationState,
    },
  }
}

describe('workerAttentionByQueen', () => {
  it('counts Workers that need the user by row state or by Delegation state', () => {
    const states = new Map<string, SidebarRowState>([['parked', 'awaiting-input']])
    const counts = workerAttentionByQueen(
      [
        worker('parked', 'working'),
        worker('needs', 'needs_attention'),
        worker('revise', 'revision_requested'),
        worker('busy', 'working'),
        worker('review', 'ready_for_review'),
        worker('gone', 'needs_attention', { archived: true }),
      ],
      (session) => states.get(String(session.id)) ?? 'idle',
    )
    // Keyed by the Hive root, not the direct parent; archived and calm Workers do not count.
    expect([...counts]).toEqual([['queen', 3]])
  })
})
