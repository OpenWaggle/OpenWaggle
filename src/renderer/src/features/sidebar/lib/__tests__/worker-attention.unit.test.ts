import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import type { HiveDelegationState } from '@/queries/session-hive-contract'
import type { SidebarRowState } from '../sidebar-row-state'
import { hiveHomeQueenId, workerAttentionByQueen } from '../worker-attention'

function worker(
  id: string,
  delegationState: HiveDelegationState,
  extra: {
    readonly archived?: boolean
    readonly historical?: boolean
    readonly parent?: string
    readonly parentWillAct?: boolean
  } = {},
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
      parentSessionId: SessionId(extra.parent ?? 'parent'),
      hiveRootSessionId: SessionId('queen'),
      ...(extra.parentWillAct === undefined ? {} : { parentWillAct: extra.parentWillAct }),
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      delegationState,
      ...(extra.historical === undefined ? {} : { historical: extra.historical }),
    },
  }
}

describe('workerAttentionByQueen', () => {
  it('counts only Needs you, and the Queen’s own Workers waiting for her (#380)', () => {
    const states = new Map<string, SidebarRowState>([
      ['parked', 'awaiting-input'],
      ['errored', 'error'],
    ])
    const counts = workerAttentionByQueen(
      [
        worker('parked', 'working'),
        // Stuck: its parent is idle with nothing queued.
        worker('stuck', 'needs_attention', { parentWillAct: false }),
        // The Queen is running, so she picks this failure up: waiting for her, not the person.
        worker('failed', 'needs_attention', { parent: 'queen', parentWillAct: true }),
        worker('review', 'ready_for_review', { parent: 'queen' }),
        // Waiting for a Worker parent, not the Queen: her line does not count it.
        worker('deep-review', 'ready_for_review'),
        worker('revise', 'revision_requested'),
        // A failed Run alone is the parent's to see, even with a red live status.
        worker('errored', 'working'),
        worker('gone', 'needs_attention', { archived: true }),
      ],
      (session) => states.get(String(session.id)) ?? 'idle',
      new Set(),
    )
    // Keyed by the Hive root, not the direct parent.
    expect([...counts]).toEqual([['queen', { needYou: 2, waiting: 2 }]])
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
    expect([...counts]).toEqual([['queen', { needYou: 1, waiting: 0 }]])
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
