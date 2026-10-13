import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import type { HiveDelegationState } from '@/queries/session-hive-contract'
import type { SidebarRowState } from '../sidebar-row-state'
import { hiveHomeQueenId, workerAttentionByQueen } from '../worker-attention'

function worker(
  id: string,
  delegationState: HiveDelegationState,
  extra: { readonly archived?: boolean; readonly historical?: boolean } = {},
): SessionSummary {
  return {
    id: SessionId(id),
    title: id,
    projectPath: '/project',
    createdAt: 1,
    updatedAt: 1,
    ...(extra.archived === undefined ? {} : { archived: extra.archived }),
    lineage: {
      role: 'worker',
      parentSessionId: SessionId('parent'),
      hiveRootSessionId: SessionId('queen'),
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      delegationState,
      ...(extra.historical === undefined ? {} : { historical: extra.historical }),
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
      new Set(),
    )
    // Keyed by the Hive root, not the direct parent; archived and calm Workers do not count.
    expect([...counts]).toEqual([['queen', 3]])
  })

  it('skips Workers that are not hidden in the Hive panel: pinned or historical', () => {
    const counts = workerAttentionByQueen(
      [
        worker('pinned', 'needs_attention'),
        worker('legacy', 'needs_attention', { historical: true }),
        worker('hidden', 'needs_attention'),
      ],
      () => 'idle',
      new Set(['pinned']),
    )
    expect([...counts]).toEqual([['queen', 1]])
  })
})

describe('hiveHomeQueenId', () => {
  it('names the Hive root of an open Spawn-lineage Worker', () => {
    expect(hiveHomeQueenId(worker('open', 'working'))).toBe('queen')
  })

  it('gives no Hive home to a legacy Worker, a non-Worker or no Session', () => {
    expect(hiveHomeQueenId(worker('legacy', 'working', { historical: true }))).toBeNull()
    expect(
      hiveHomeQueenId({
        id: SessionId('solo'),
        title: 'solo',
        projectPath: '/project',
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toBeNull()
    expect(hiveHomeQueenId(undefined)).toBeNull()
  })
})
