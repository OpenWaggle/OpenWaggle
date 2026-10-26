import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import type { HiveDelegationState, HiveSession } from '@/queries/session-hive-contract'
import { buildHiveLineageIndex } from '../hive-lineage-index'
import { buildHiveTreeItems, type HiveTreeItem } from '../hive-tree-structure'

const queen: HiveSession = {
  id: SessionId('queen'),
  title: 'Queen',
  lineage: { role: 'queen', directWorkerCount: 2, activeDirectWorkerCount: 2 },
}

function worker(
  id: string,
  parent: string,
  createdAt: number,
  options: { readonly state?: HiveDelegationState; readonly archived?: boolean } = {},
): HiveSession {
  return {
    id: SessionId(id),
    title: id,
    createdAt,
    ...(options.archived ? { archived: true } : {}),
    lineage: {
      role: 'worker',
      parentSessionId: SessionId(parent),
      parentTitle: parent === 'queen' ? 'Queen' : parent,
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      delegationState: options.state ?? 'working',
    },
  }
}

/** Queen → a, b; a → a1 (needs attention), a2 (archived); b → b1, b2 (ready for review). */
const threeLevels = [
  worker('b2', 'b', 9, { state: 'ready_for_review' }),
  worker('a2', 'a', 6, { state: 'accepted', archived: true }),
  worker('b', 'queen', 2),
  worker('a1', 'a', 5, { state: 'needs_attention' }),
  worker('a', 'queen', 1),
  worker('b1', 'b', 8),
]

function tree(
  members: readonly HiveSession[],
  options: { readonly showArchived?: boolean; readonly collapsed?: readonly string[] } = {},
) {
  return buildHiveTreeItems({
    root: queen,
    members,
    showArchived: options.showArchived ?? false,
    collapsed: new Set(options.collapsed ?? []),
  })
}

function outline(items: readonly HiveTreeItem[]) {
  return items.map((item) => `${'  '.repeat(item.level - 1)}${String(item.session.id)}`)
}

describe('buildHiveTreeItems', () => {
  it('lists every Worker under its own parent, siblings by creation time', () => {
    const items = tree(threeLevels, { showArchived: true })

    expect(outline(items)).toEqual(['queen', '  a', '    a1', '    a2', '  b', '    b1', '    b2'])
    const a = items.find((item) => String(item.session.id) === 'a')
    expect(a).toMatchObject({ level: 2, posInSet: 1, setSize: 2, childCount: 2, expanded: true })
    expect(items.find((item) => String(item.session.id) === 'b2')).toMatchObject({
      level: 3,
      posInSet: 2,
      setSize: 2,
      expanded: null,
      parentTitle: 'b',
      ancestry: ['Queen', 'b'],
    })
  })

  it('hides archived Workers by default and counts them on their parent', () => {
    const items = tree(threeLevels)

    expect(outline(items)).toEqual(['queen', '  a', '    a1', '  b', '    b1', '    b2'])
    expect(items.find((item) => String(item.session.id) === 'a')).toMatchObject({
      childCount: 1,
      archivedCount: 1,
    })
  })

  it('shows the archived Workers in place, dimmed, when asked', () => {
    const archived = tree(threeLevels, { showArchived: true }).find(
      (item) => String(item.session.id) === 'a2',
    )
    expect(archived).toMatchObject({ dimmed: true, archivedCount: 0 })
  })

  it('always shows an archived Worker that has live children, so none is orphaned', () => {
    const items = tree([
      worker('parent', 'queen', 1, { archived: true, state: 'accepted' }),
      worker('live', 'parent', 2),
      worker('gone', 'parent', 3, { archived: true, state: 'accepted' }),
    ])

    expect(outline(items)).toEqual(['queen', '  parent', '    live'])
    expect(items.find((item) => String(item.session.id) === 'parent')).toMatchObject({
      dimmed: true,
      archivedCount: 1,
    })
  })

  it('hides the children of a collapsed Worker and rolls up who needs the user', () => {
    const items = tree(threeLevels, { collapsed: ['a', 'b'] })

    expect(outline(items)).toEqual(['queen', '  a', '  b'])
    expect(items.find((item) => String(item.session.id) === 'a')).toMatchObject({
      expanded: false,
      rollUp: { needsAttention: 1, readyForReview: 0 },
    })
    expect(items.find((item) => String(item.session.id) === 'b')).toMatchObject({
      expanded: false,
      rollUp: { needsAttention: 0, readyForReview: 1 },
    })
    // An expanded Worker shows its children instead of a roll-up.
    expect(tree(threeLevels).find((item) => String(item.session.id) === 'a')?.rollUp).toBeNull()
  })

  it('rolls deeper descendants up through a collapsed ancestor', () => {
    const items = tree(
      [
        worker('a', 'queen', 1),
        worker('a1', 'a', 2),
        worker('a11', 'a1', 3, { state: 'revision_requested' }),
      ],
      { collapsed: ['queen'] },
    )
    expect(outline(items)).toEqual(['queen'])
    expect(items[0]?.rollUp).toEqual({ needsAttention: 1, readyForReview: 0 })
  })

  it('keeps a Worker whose parent is not loaded at the top level until the parent arrives', () => {
    const orphanOnly = tree([worker('child', 'later', 5)])
    expect(outline(orphanOnly)).toEqual(['queen', '  child'])
    expect(orphanOnly[1]).toMatchObject({ orphanParentTitle: 'later', level: 2 })

    const reparented = tree([worker('child', 'later', 5), worker('later', 'queen', 1)])
    expect(outline(reparented)).toEqual(['queen', '  later', '    child'])
    expect(reparented[2]?.orphanParentTitle).toBeNull()
  })

  it('lists Workers of a corrupt parent cycle on top instead of losing them', () => {
    const items = tree([worker('x', 'y', 1), worker('y', 'x', 2)])
    expect(outline(items)).toEqual(['queen', '  x', '  y'])
  })

  it('caps indentation at four levels and badges the deeper rows', () => {
    const chain = ['d1', 'd2', 'd3', 'd4', 'd5'].map((id, index, ids) =>
      worker(id, index === 0 ? 'queen' : (ids[index - 1] ?? 'queen'), index),
    )
    const items = tree(chain)
    expect(items.map((item) => [item.depth, item.indent, item.depthBadge])).toEqual([
      [0, 0, null],
      [1, 1, null],
      [2, 2, null],
      [3, 3, null],
      [4, 4, null],
      [5, 4, 'L5'],
    ])
  })
})

describe('buildHiveLineageIndex', () => {
  it('records each member’s parent and its chain of ancestors from the Queen', () => {
    const index = buildHiveLineageIndex({ root: queen, members: threeLevels })

    expect(index.get('a1')).toEqual({
      depth: 2,
      parentId: 'a',
      parentTitle: 'a',
      parentLoaded: true,
      ancestry: ['Queen', 'a'],
    })
    expect(index.get('a')).toMatchObject({ depth: 1, parentId: 'queen', ancestry: ['Queen'] })
  })

  it('marks a parent that is not loaded yet', () => {
    const index = buildHiveLineageIndex({ root: queen, members: [worker('child', 'later', 5)] })

    expect(index.get('child')).toMatchObject({
      parentId: 'later',
      parentTitle: 'later',
      parentLoaded: false,
      ancestry: ['Queen', '…', 'later'],
    })
  })
})
