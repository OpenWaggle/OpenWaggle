import type { HiveSession } from '@/queries/session-hive-contract'
import {
  HIVE_DELEGATION_LABELS,
  type HiveDelegationState,
  hiveStateNeedsAttention,
} from '@/queries/session-hive-contract'

/**
 * One row of the Hive panel, derived without hooks so grouping stays a pure function.
 *
 * `via` is the Worker's parent title for members below the first level: the panel lists the
 * whole Hive flat, and ADR 0051 labels depth with text rather than indentation.
 */
export interface HiveTreeRow {
  readonly session: HiveSession
  readonly via: string | null
}

export interface HiveTreeGroups {
  readonly needsYou: readonly HiveTreeRow[]
  readonly review: readonly HiveTreeRow[]
  readonly active: readonly HiveTreeRow[]
  readonly done: readonly HiveTreeRow[]
  readonly archived: readonly HiveTreeRow[]
}

export interface HiveTreeModel {
  readonly root: HiveSession | null
  readonly currentSessionId: string | null
  readonly groups: HiveTreeGroups
  readonly memberCount: number
}

function rowFor(session: HiveSession, rootId: string | null): HiveTreeRow {
  const parentId = session.lineage?.parentSessionId
  const parentTitle = session.lineage?.parentTitle
  const via =
    rootId !== null && parentId !== undefined && String(parentId) !== rootId
      ? (parentTitle ?? null)
      : null
  return { session, via }
}

/**
 * Group the Hive from its Queen down (ADR 0051): Needs you, Review, Active, Done, then
 * `Archived · n`. The same delegation-state rule the Session Hub's Hive summary uses, applied
 * across every depth; Workers the legacy task runner produced are not Spawn lineage and are
 * not part of the panel's Hive.
 */
export function buildHiveTreeModel(input: {
  readonly root: HiveSession | null
  readonly members: readonly HiveSession[]
  readonly currentSessionId: string | null
}): HiveTreeModel {
  const rootId = input.root === null ? null : String(input.root.id)
  const needsYou: HiveTreeRow[] = []
  const review: HiveTreeRow[] = []
  const active: HiveTreeRow[] = []
  const done: HiveTreeRow[] = []
  const archived: HiveTreeRow[] = []
  for (const member of input.members) {
    const row = rowFor(member, rootId)
    if (member.archived === true) {
      archived.push(row)
      continue
    }
    const state = member.lineage?.delegationState
    if (state === 'accepted' || state === 'cancelled') {
      done.push(row)
      continue
    }
    if (state === 'ready_for_review') {
      review.push(row)
      continue
    }
    if (hiveStateNeedsAttention(state)) {
      needsYou.push(row)
      continue
    }
    active.push(row)
  }
  return {
    root: input.root,
    currentSessionId: input.currentSessionId,
    groups: { needsYou, review, active, done, archived },
    memberCount: input.members.length,
  }
}

/** What each row's trailing state label means, for the row's tooltip (ADR 0051). */
const HIVE_STATE_HINTS = {
  working: 'The Worker is carrying out its delegation.',
  waiting: 'The Worker has finished its turn and waits for the next one.',
  needs_attention: 'This Worker needs your input before it can continue.',
  ready_for_review: 'The Worker finished and waits for the Queen to review its result.',
  revision_requested: 'The Queen asked this Worker to revise its result.',
  accepted: 'The Queen accepted this Worker’s result.',
  cancelled: 'The delegation was cancelled.',
} as const satisfies Readonly<Record<HiveDelegationState, string>>

/**
 * The short form of each Delegation state, for the row's State column (ADR 0051 review).
 * The group heading already names the state family, so the cell only distinguishes within it.
 */
const HIVE_STATE_SHORT_LABELS = {
  working: 'Working',
  waiting: 'Waiting',
  needs_attention: 'You',
  ready_for_review: 'Review',
  revision_requested: 'Revision',
  accepted: 'Accepted',
  cancelled: 'Cancelled',
} as const satisfies Readonly<Record<HiveDelegationState, string>>

/** The row's second line: the Delegation state, else the row's live run status. */
export function hiveRowStateLabel(
  session: HiveSession,
  fallback: string,
): {
  readonly label: string
  /** Short form for the State column; the group heading carries the state family. */
  readonly short: string
  readonly needsAttention: boolean
  /** Plain-language explanation of the label, for the row's tooltip. */
  readonly hint: string
} {
  const state = session.lineage?.delegationState
  if (state !== undefined && state !== null) {
    return {
      label: HIVE_DELEGATION_LABELS[state],
      short: HIVE_STATE_SHORT_LABELS[state],
      needsAttention: hiveStateNeedsAttention(state),
      hint: HIVE_STATE_HINTS[state],
    }
  }
  return {
    label: fallback,
    short: fallback,
    needsAttention: false,
    hint: `Live Session status: ${fallback}`,
  }
}
