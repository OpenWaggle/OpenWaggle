import { match } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'

type ProjectedLineage = NonNullable<SessionSummary['lineage']>
export const HIVE_DELEGATION_LABELS = {
  working: 'Working',
  waiting: 'Waiting',
  needs_attention: 'Needs attention',
  ready_for_review: 'Ready for review',
  revision_requested: 'Revision requested',
  accepted: 'Accepted',
  cancelled: 'Cancelled',
} as const satisfies Readonly<Record<NonNullable<ProjectedLineage['delegationState']>, string>>

export type HiveDelegationState = keyof typeof HIVE_DELEGATION_LABELS

/**
 * The states that need the user, grouped as Needs attention (ADR 0051, renamed in #356):
 * `needs_attention` and `revision_requested`. `ready_for_review` has its own group: the next
 * step is the Queen's.
 */
export function hiveStateNeedsAttention(state: HiveDelegationState | null | undefined) {
  return state === 'needs_attention' || state === 'revision_requested'
}

/** Where a Worker sits in the Hive panel, and how the Session Summary counts it. */
export type HiveDelegationGroup = 'needs-attention' | 'ready-for-review' | 'active' | 'closed'

/**
 * One name per group, in the domain's words (#356): a group named for a single state uses that
 * state's label, and the closed group is not "Done", which names a finished Run.
 */
export const HIVE_DELEGATION_GROUP_LABELS = {
  'needs-attention': HIVE_DELEGATION_LABELS.needs_attention,
  'ready-for-review': HIVE_DELEGATION_LABELS.ready_for_review,
  active: 'Active',
  closed: 'Closed',
} as const satisfies Readonly<Record<HiveDelegationGroup, string>>

/** A Worker without a Delegation yet counts as Active, like `working` and `waiting`. */
export function hiveDelegationGroup(
  state: HiveDelegationState | null | undefined,
): HiveDelegationGroup {
  return match(state ?? null)
    .with('needs_attention', 'revision_requested', () => 'needs-attention' as const)
    .with('ready_for_review', () => 'ready-for-review' as const)
    .with('accepted', 'cancelled', () => 'closed' as const)
    .with('working', 'waiting', null, () => 'active' as const)
    .exhaustive()
}

/** Read-only subset shared by the current projection and the Session Host catalog. */
export interface HiveLineage {
  readonly role: 'queen' | 'worker' | 'independent'
  readonly parentSessionId?: SessionId | null
  readonly parentTitle?: string | null
  readonly directWorkerCount: number
  readonly activeDirectWorkerCount: number
  readonly agentDefinitionName?: string | null
  readonly delegationState?: HiveDelegationState | null
  readonly historical?: boolean
}

export interface HiveSession {
  readonly id: SessionId
  readonly title: string
  readonly archived?: boolean
  readonly lineage?: HiveLineage
  /** Where the Session works, shown as the row's Workspace placement (ADR 0051). */
  readonly worktreePath?: string | null
  readonly pendingInteractionAt?: number
  readonly followUpEditHeldAt?: number
}

export interface HiveRelationsPage {
  readonly current: HiveSession | null
  readonly parent: HiveSession | null
  readonly workers: readonly HiveSession[]
  readonly nextCursor?: string
}

export interface HiveCatalogPage {
  readonly context: readonly HiveSession[]
  readonly workers: readonly HiveSession[]
  readonly nextCursor?: string
}

/** Structural compatibility boundary, not another orchestration or persistence API. */
export interface SessionHiveReader {
  readonly listHiveSessionCatalogPage?: (
    sessionId: SessionId,
    limit: number,
    cursor?: string,
  ) => Promise<HiveCatalogPage>
  readonly getSessionHiveRelations?: (sessionId: SessionId) => Promise<HiveRelationsPage>
}
