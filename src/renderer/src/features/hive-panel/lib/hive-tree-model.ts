import { match } from '@diegogbrisa/ts-match'
import type { SessionStatus } from '@shared/types/session-status'
import type { HiveSession } from '@/queries/session-hive-contract'
import {
  hiveMemberNextActor,
  hiveNextActorGroup,
  hiveNextActorLabel,
  hiveParentName,
} from '@/queries/session-hive-next-actor'
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

/** One row of the Hive panel's By next actor view, derived without hooks so grouping stays pure. */
export interface HiveTreeRow {
  readonly session: HiveSession
  /** null for the Queen, and while the Queen is unreadable (depth is then unknown). */
  readonly parent: HiveRowParent | null
}

/** Workers whose parent acts next, under "Waiting for ‹parent›", one group per parent. */
export interface HiveWaitingGroup {
  readonly parentId: string
  readonly parentTitle: string
  readonly rows: readonly HiveTreeRow[]
}

export interface HiveTreeGroups {
  readonly needsYou: readonly HiveTreeRow[]
  readonly waiting: readonly HiveWaitingGroup[]
  readonly working: readonly HiveTreeRow[]
  readonly closed: readonly HiveTreeRow[]
  readonly archived: readonly HiveTreeRow[]
}

export interface HiveTreeModel {
  readonly root: HiveSession | null
  /** The Queen's own parked request puts her row in Needs you rather than on top (issue 380). */
  readonly rootNeedsYou: boolean
  readonly currentSessionId: string | null
  readonly groups: HiveTreeGroups
  readonly memberCount: number
}

/** A live Session status by id, when the window knows one. */
export type HiveStatusOf = (sessionId: string) => SessionStatus | undefined

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
 * Group the Hive from its Queen down by who acts next (ADR 0059): Needs you, Waiting for
 * ‹parent› (one group per parent, in the order their first Worker appears), Working, Closed, then
 * `Archived · n`. The rule is the shared `hiveNextActor`, the one the Session Hub's Hive row, the
 * rail dot and the sidebar use, applied across every depth; Workers the legacy task runner
 * produced are not Spawn lineage and are not part of the panel's Hive.
 */
export function buildHiveTreeModel(input: {
  readonly root: HiveSession | null
  readonly members: readonly HiveSession[]
  readonly currentSessionId: string | null
  readonly statusOf?: HiveStatusOf
}): HiveTreeModel {
  const rootId = input.root === null ? null : String(input.root.id)
  const statusOf = input.statusOf ?? (() => undefined)
  const lineage = buildHiveLineageIndex({ root: input.root, members: input.members })
  const needsYou: HiveTreeRow[] = []
  const waiting = new Map<string, { parentTitle: string; rows: HiveTreeRow[] }>()
  const working: HiveTreeRow[] = []
  const closed: HiveTreeRow[] = []
  const archived: HiveTreeRow[] = []
  const root = input.root
  const rootNeedsYou =
    root !== null && hiveMemberNextActor(root, statusOf(String(root.id)))?.nextActor === 'user'
  if (root !== null && rootNeedsYou) needsYou.push({ session: root, parent: null })
  for (const member of input.members) {
    const row = rowFor(member, rootId, lineage)
    if (member.archived === true) {
      archived.push(row)
      continue
    }
    match(hiveNextActorGroup(hiveMemberNextActor(member, statusOf(String(member.id)))))
      .with('needs-you', () => needsYou.push(row))
      .with('working', () => working.push(row))
      .with('closed', () => closed.push(row))
      .with('waiting', () => {
        const parentId = String(member.lineage?.parentSessionId ?? '')
        const entry = waiting.get(parentId) ?? { parentTitle: hiveParentName(member), rows: [] }
        entry.rows.push(row)
        waiting.set(parentId, entry)
      })
      .exhaustive()
  }
  return {
    root,
    rootNeedsYou,
    currentSessionId: input.currentSessionId,
    groups: {
      needsYou,
      waiting: [...waiting].map(([parentId, entry]) => ({ parentId, ...entry })),
      working,
      closed,
      archived,
    },
    memberCount: input.members.length,
  }
}

/**
 * The row's State cell: what the next-actor rule says and why (ADR 0059), else the row's live run
 * status, for a Session with no Delegation and nothing parked, such as an idle Queen.
 */
export function hiveRowStateLabel(
  session: HiveSession,
  fallback: string,
  liveStatus?: SessionStatus,
): {
  readonly label: string
  /** Only the person can unblock it: the row reads in the attention colour. */
  readonly needsYou: boolean
  /** Plain-language explanation of the label, for the row's tooltip. */
  readonly hint: string
} {
  const next = hiveMemberNextActor(session, liveStatus)
  if (next !== null) {
    return {
      ...hiveNextActorLabel(next.reason, hiveParentName(session)),
      needsYou: next.nextActor === 'user',
    }
  }
  return { label: fallback, needsYou: false, hint: `Live Session status: ${fallback}` }
}
