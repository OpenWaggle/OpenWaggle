import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import type { HiveDelegationState, HiveSession } from '@/queries/session-hive-contract'
import { buildHiveTreeModel, hiveRowStateLabel } from '../hive-tree-model'

function member(
  id: string,
  state: HiveDelegationState | null,
  overrides: { readonly parentTitle?: string; readonly archived?: boolean } = {},
): HiveSession {
  return {
    id: SessionId(id),
    title: id,
    lineage: {
      role: 'worker',
      parentSessionId: SessionId('root'),
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      ...(state !== null ? { delegationState: state } : {}),
      ...(overrides.parentTitle !== undefined ? { parentTitle: overrides.parentTitle } : {}),
    },
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {}),
  }
}

const root: HiveSession = {
  id: SessionId('root'),
  title: 'root',
  lineage: { role: 'queen', directWorkerCount: 4, activeDirectWorkerCount: 2 },
}

describe('buildHiveTreeModel', () => {
  it('groups the hive into Needs attention, Ready for review, Active, Closed and Archived', () => {
    const model = buildHiveTreeModel({
      root,
      members: [
        member('needs-you', 'needs_attention'),
        member('revision', 'revision_requested'),
        member('review', 'ready_for_review'),
        member('active', 'working'),
        member('waiting', 'waiting'),
        member('unassigned', null),
        member('done', 'accepted'),
        member('cancelled', 'cancelled'),
        member('archived', 'working', { archived: true }),
      ],
      currentSessionId: 'root',
    })

    expect(model.groups.needsAttention.map((row) => String(row.session.id))).toEqual([
      'needs-you',
      'revision',
    ])
    expect(model.groups.readyForReview.map((row) => String(row.session.id))).toEqual(['review'])
    expect(model.groups.active.map((row) => String(row.session.id))).toEqual([
      'active',
      'waiting',
      'unassigned',
    ])
    expect(model.groups.closed.map((row) => String(row.session.id))).toEqual(['done', 'cancelled'])
    expect(model.groups.archived.map((row) => String(row.session.id))).toEqual(['archived'])
    expect(model.memberCount).toBe(9)
  })

  it('labels members below the first level via their parent, direct Workers not', () => {
    const deepChild: HiveSession = {
      ...member('deep', 'working'),
      lineage: {
        role: 'worker',
        parentSessionId: SessionId('mid'),
        parentTitle: 'Mid worker',
        directWorkerCount: 0,
        activeDirectWorkerCount: 0,
      },
    }
    const model = buildHiveTreeModel({
      root,
      members: [member('direct', 'working', { parentTitle: 'root' }), deepChild],
      currentSessionId: null,
    })

    expect(model.groups.active.map((row) => row.via)).toEqual([null, 'Mid worker'])
  })

  it('labels no row via its parent when the Queen is unreadable, because depth is unknown', () => {
    const model = buildHiveTreeModel({
      root: null,
      members: [member('direct', 'working', { parentTitle: 'root' })],
      currentSessionId: null,
    })
    expect(model.groups.active[0]?.via).toBeNull()
  })
})

describe('hiveRowStateLabel', () => {
  it('names every Delegation state with one label, the one the domain uses', () => {
    const labels = (
      [
        'working',
        'waiting',
        'needs_attention',
        'ready_for_review',
        'revision_requested',
        'accepted',
        'cancelled',
      ] as const
    ).map((state) => hiveRowStateLabel(member('a', state), 'Idle').label)
    expect(labels).toEqual([
      'Working',
      'Waiting',
      'Needs attention',
      'Ready for review',
      'Revision requested',
      'Accepted',
      'Cancelled',
    ])
  })

  it('prefers the Delegation state and flags attention', () => {
    expect(hiveRowStateLabel(member('a', 'needs_attention'), 'Idle')).toEqual({
      label: 'Needs attention',
      needsAttention: true,
      hint: 'This Worker needs your input before it can continue.',
    })
    expect(hiveRowStateLabel(member('a', 'ready_for_review'), 'Idle')).toEqual({
      label: 'Ready for review',
      needsAttention: false,
      hint: 'The Worker finished and waits for the Queen to review its result.',
    })
  })

  it('falls back to the run status for Workers without a Delegation state', () => {
    expect(hiveRowStateLabel(member('a', null), 'Working')).toEqual({
      label: 'Working',
      needsAttention: false,
      hint: 'Live Session status: Working',
    })
  })
})
