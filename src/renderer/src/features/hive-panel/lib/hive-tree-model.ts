import type { HiveSession } from '@/queries/session-hive-contract'
import {
  HIVE_DELEGATION_LABELS,
  type HiveDelegationGroup,
  type HiveDelegationState,
  hiveDelegationGroup,
  hiveStateNeedsAttention,
} from '@/queries/session-hive-contract'
import { buildHiveLineageIndex, type HiveLineageEntry } from './hive-lineage-index'

/** The parent a Hive panel row names: "Spawned by ‹title›" (#377). */
export interface HiveRowParent {
  readonly id: string
  readonly title: string
  /** False while the parent's page has not arrived. */
  readonly loaded: boolean
  /** The parent is the Queen, whose row is always on top. */
  readonly isQueen: boolean
  /** Titles from the Queen down to the parent, for the row's tooltip. */
  readonly ancestry: readonly string[]
}

/** One row of the Hive panel's By state view, derived without hooks so grouping stays pure. */
export interface HiveTreeRow {
  readonly session: HiveSession
  /** null for the Queen, and while the Queen is unreadable (depth is then unknown). */
  readonly parent: HiveRowParent | null
}

export interface HiveTreeGroups {
  readonly needsAttention: readonly HiveTreeRow[]
  readonly readyForReview: readonly HiveTreeRow[]
  readonly active: readonly HiveTreeRow[]
  readonly closed: readonly HiveTreeRow[]
  readonly archived: readonly HiveTreeRow[]
}

export interface HiveTreeModel {
  readonly root: HiveSession | null
  readonly currentSessionId: string | null
  readonly groups: HiveTreeGroups
  readonly memberCount: number
}

function rowFor(
  session: HiveSession,
  rootId: string | null,
  lineage: ReadonlyMap<string, HiveLineageEntry>,
): HiveTreeRow {
  const entry = lineage.get(String(session.id))
  if (rootId === null || entry === undefined || entry.parentId === null) {
    return { session, parent: null }
  }
  return {
    session,
    parent: {
      id: entry.parentId,
      title: entry.parentTitle ?? '…',
      loaded: entry.parentLoaded,
      isQueen: entry.parentId === rootId,
      ancestry: entry.ancestry,
    },
  }
}

/**
 * Group the Hive from its Queen down (ADR 0051, names from #356): Needs attention, Ready for
 * review, Active, Closed, then `Archived · n`. The same delegation-state rule the Session Hub's
 * Hive summary uses ({@link hiveDelegationGroup}), applied across every depth; Workers the legacy
 * task runner produced are not Spawn lineage and are not part of the panel's Hive.
 */
export function buildHiveTreeModel(input: {
  readonly root: HiveSession | null
  readonly members: readonly HiveSession[]
  readonly currentSessionId: string | null
}): HiveTreeModel {
  const rootId = input.root === null ? null : String(input.root.id)
  const lineage = buildHiveLineageIndex({ root: input.root, members: input.members })
  const groups: Record<HiveDelegationGroup, HiveTreeRow[]> = {
    'needs-attention': [],
    'ready-for-review': [],
    active: [],
    closed: [],
  }
  const archived: HiveTreeRow[] = []
  for (const member of input.members) {
    const row = rowFor(member, rootId, lineage)
    if (member.archived === true) archived.push(row)
    else groups[hiveDelegationGroup(member.lineage?.delegationState)].push(row)
  }
  return {
    root: input.root,
    currentSessionId: input.currentSessionId,
    groups: {
      needsAttention: groups['needs-attention'],
      readyForReview: groups['ready-for-review'],
      active: groups.active,
      closed: groups.closed,
      archived,
    },
    memberCount: input.members.length,
  }
}

/** What each row's trailing state label means, for the row's tooltip (ADR 0051). */
const HIVE_STATE_HINTS = {
  working: 'The Worker is carrying out its delegation.',
  waiting: 'The Worker waits for a condition it declared, such as another Delegation.',
  needs_attention: 'This Worker needs your input before it can continue.',
  ready_for_review: 'The Worker finished and waits for the Queen to review its result.',
  revision_requested: 'The Queen asked this Worker to revise its result.',
  accepted: 'The Queen accepted this Worker’s result.',
  cancelled: 'The delegation was cancelled.',
} as const satisfies Readonly<Record<HiveDelegationState, string>>

/** The row's second line: the Delegation state, else the row's live run status. */
export function hiveRowStateLabel(
  session: HiveSession,
  fallback: string,
): {
  readonly label: string
  readonly needsAttention: boolean
  /** Plain-language explanation of the label, for the row's tooltip. */
  readonly hint: string
} {
  const state = session.lineage?.delegationState
  if (state !== undefined && state !== null) {
    return {
      label: HIVE_DELEGATION_LABELS[state],
      needsAttention: hiveStateNeedsAttention(state),
      hint: HIVE_STATE_HINTS[state],
    }
  }
  return {
    label: fallback,
    needsAttention: false,
    hint: `Live Session status: ${fallback}`,
  }
}
