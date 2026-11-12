import type { SessionId } from '@shared/types/brand'
import type { HiveAttentionCause } from '@shared/types/hive-next-actor'
import type { SessionSummary } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'

/**
 * The Delegation states on the wire. The Hive shows who acts next instead (ADR 0059): see
 * `session-hive-next-actor.ts`.
 */
export type HiveDelegationState = NonNullable<
  NonNullable<SessionSummary['lineage']>['delegationState']
>

/** Read-only subset shared by the current projection and the Session Host catalog. */
export interface HiveLineage {
  readonly role: 'queen' | 'worker' | 'independent'
  readonly parentSessionId?: SessionId | null
  readonly parentTitle?: string | null
  readonly directWorkerCount: number
  readonly activeDirectWorkerCount: number
  readonly agentDefinitionName?: string | null
  /** Set with agentDefinitionName: the Worker's model and thinking level setting (Hive panel identity line). */
  readonly agentModelId?: string | null
  readonly agentThinkingLevel?: ThinkingLevel | null
  readonly delegationState?: HiveDelegationState | null
  /** Why the Delegation is `needs_attention` (ADR 0059). */
  readonly attentionCause?: HiveAttentionCause | null
  /** The parent will pick the Worker up without the person (ADR 0059). */
  readonly parentWillAct?: boolean
  readonly historical?: boolean
}

/** The SessionSummary fields the Hive reads; the Session Host catalog sends SessionSummary. */
type HiveSessionSummaryFields = Pick<
  SessionSummary,
  | 'id'
  | 'title'
  | 'archived'
  | 'worktreePath'
  | 'pendingInteractionAt'
  | 'pendingInteractionKind'
  | 'followUpEditHeldAt'
>

export interface HiveSession extends HiveSessionSummaryFields {
  /** Siblings in the Hive panel's tree are ordered by creation (#377). */
  readonly createdAt?: number
  readonly lineage?: HiveLineage
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
