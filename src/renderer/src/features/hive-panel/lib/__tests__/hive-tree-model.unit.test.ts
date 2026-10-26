import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import type { HiveDelegationState, HiveSession } from '@/queries/session-hive-contract'
import { buildHiveTreeModel, hiveRowStateLabel } from '../hive-tree-model'

function member(
  id: string,
  state: HiveDelegationState | null,
  overrides: {
    readonly parentTitle?: string
    readonly archived?: boolean
    readonly lineage?: Partial<NonNullable<HiveSession['lineage']>>
    readonly pendingInteractionKind?: 'approval' | 'question'
  } = {},
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
      ...overrides.lineage,
    },
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {}),
    ...(overrides.pendingInteractionKind
      ? { pendingInteractionKind: overrides.pendingInteractionKind }
      : {}),
  }
}

const ids = (rows: readonly { readonly session: HiveSession }[]) =>
  rows.map((row) => String(row.session.id))

const root: HiveSession = {
  id: SessionId('root'),
  title: 'root',
  lineage: { role: 'queen', directWorkerCount: 4, activeDirectWorkerCount: 2 },
}

describe('buildHiveTreeModel', () => {
  it('groups the Hive by who acts next: Needs you, Waiting for ‹parent›, Working, Closed (issue 380)', () => {
    const failed = { attentionCause: 'run_failed' as const }
    const model = buildHiveTreeModel({
      root,
      members: [
        member('stuck', 'needs_attention', { lineage: { ...failed, parentWillAct: false } }),
        member('approval', 'working', { pendingInteractionKind: 'approval' }),
        member('failed', 'needs_attention', {
          parentTitle: 'root',
          lineage: { ...failed, parentWillAct: true },
        }),
        member('deep-review', 'ready_for_review', {
          parentTitle: 'Mid',
          lineage: { parentSessionId: SessionId('mid') },
        }),
        member('review', 'ready_for_review', { parentTitle: 'root' }),
        member('turn', 'waiting', { parentTitle: 'root' }),
        member('revision', 'revision_requested'),
        member('active', 'working'),
        member('unassigned', null),
        member('done', 'accepted'),
        member('cancelled', 'cancelled'),
        member('archived', 'needs_attention', { archived: true }),
      ],
      currentSessionId: 'root',
    })

    expect(ids(model.groups.needsYou)).toEqual(['stuck', 'approval'])
    expect(
      model.groups.waiting.map((group) => [group.parentTitle, ids(group.rows)] as const),
    ).toEqual([
      ['root', ['failed', 'review', 'turn']],
      ['Mid', ['deep-review']],
    ])
    // A Worker the parent asked to revise is working on it, not waiting for anyone.
    expect(ids(model.groups.working)).toEqual(['revision', 'active', 'unassigned'])
    expect(ids(model.groups.closed)).toEqual(['done', 'cancelled'])
    expect(ids(model.groups.archived)).toEqual(['archived'])
    expect(model.rootNeedsYou).toBe(false)
    expect(model.memberCount).toBe(12)
  })

  it('puts the Queen in Needs you while her own request waits, live status first', () => {
    const parked = { ...root, pendingInteractionKind: 'question' as const }
    const model = buildHiveTreeModel({ root: parked, members: [], currentSessionId: null })
    expect(model.rootNeedsYou).toBe(true)
    expect(ids(model.groups.needsYou)).toEqual(['root'])
    // The live status says the request was answered before the Host was read again.
    const answered = buildHiveTreeModel({
      root: parked,
      members: [member('live', 'working')],
      currentSessionId: null,
      statusOf: (id) => (id === 'root' ? 'working' : 'awaiting-input'),
    })
    expect(answered.rootNeedsYou).toBe(false)
    expect(ids(answered.groups.needsYou)).toEqual(['live'])
  })

  it('names each member’s parent, and which ones are direct Workers of the Queen', () => {
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

    expect(model.groups.working.map((row) => [row.parent?.title, row.parent?.isQueen])).toEqual([
      ['root', true],
      ['Mid worker', false],
    ])
    expect(model.groups.working[1]?.parent).toMatchObject({ id: 'mid', loaded: false })
  })

  it('names no parent when the Queen is unreadable, because depth is unknown', () => {
    const model = buildHiveTreeModel({
      root: null,
      members: [member('direct', 'working', { parentTitle: 'root' })],
      currentSessionId: null,
    })
    expect(model.groups.working[0]?.parent).toBeNull()
  })
})

describe('hiveRowStateLabel', () => {
  it('says why, in the issue’s words, naming the parent where it acts next (issue 380)', () => {
    const labelOf = (session: HiveSession, live?: Parameters<typeof hiveRowStateLabel>[2]) =>
      hiveRowStateLabel(session, 'Idle', live).label
    const queenChild = { parentTitle: 'Queen' }
    expect(labelOf(member('a', 'working', { pendingInteractionKind: 'approval' }))).toBe(
      'Waiting for your approval',
    )
    expect(labelOf(member('a', 'working'), 'awaiting-input')).toBe('Waiting for your answer')
    expect(labelOf(member('a', 'needs_attention'))).toBe('Stuck — no agent will pick it up')
    expect(labelOf(member('a', 'ready_for_review', queenChild))).toBe('Ready for review')
    expect(
      labelOf(member('a', 'needs_attention', { ...queenChild, lineage: { parentWillAct: true } })),
    ).toBe('Run failed, Queen notified')
    expect(
      labelOf(
        member('a', 'needs_attention', {
          ...queenChild,
          lineage: { parentWillAct: true, attentionCause: 'worker_request' },
        }),
      ),
    ).toBe('Asked Queen for help')
    expect(labelOf(member('a', 'waiting'))).toBe('Finished its turn')
    expect(labelOf(member('a', 'working'))).toBe('Working')
    expect(labelOf(member('a', 'working'), 'connecting')).toBe('Connecting')
    expect(labelOf(member('a', 'revision_requested'))).toBe('Revising')
    expect(labelOf(member('a', 'accepted'))).toBe('Accepted')
    expect(labelOf(member('a', 'cancelled'))).toBe('Cancelled')
  })

  it('flags only what needs you', () => {
    expect(hiveRowStateLabel(member('a', 'needs_attention'), 'Idle')).toMatchObject({
      needsYou: true,
    })
    expect(
      hiveRowStateLabel(
        member('a', 'needs_attention', { lineage: { parentWillAct: true } }),
        'Idle',
      ),
    ).toMatchObject({ needsYou: false })
    expect(hiveRowStateLabel(member('a', 'revision_requested'), 'Idle').needsYou).toBe(false)
  })

  it('falls back to the run status for a Session the rule says nothing about', () => {
    expect(hiveRowStateLabel(member('a', null), 'Working')).toEqual({
      label: 'Working',
      needsYou: false,
      hint: 'Live Session status: Working',
    })
  })
})
