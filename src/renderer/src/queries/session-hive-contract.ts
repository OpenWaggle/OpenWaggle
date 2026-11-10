import type { SessionId } from '@shared/types/brand'
import type { HiveAttentionCause, HivePendingRequest } from '@shared/types/hive-next-actor'
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

export interface HiveSession {
  readonly id: SessionId
  readonly title: string
  /** Siblings in the Hive panel's tree are ordered by creation (#377). */
  readonly createdAt?: number
  readonly archived?: boolean | undefined
  readonly lineage?: HiveLineage | undefined
  /** Where the Session works, shown as the row's Workspace placement (ADR 0051). */
  readonly worktreePath?: string | null | undefined
  readonly pendingInteractionAt?: number | undefined
  /** What the parked interactions ask of the person (ADR 0059). */
  readonly pendingInteractionKind?: HivePendingRequest | undefined
  readonly followUpEditHeldAt?: number | undefined
}

export interface HiveRelationsPage {
  readonly current: HiveSession | null
  readonly parent: HiveSession | null
  readonly workers: readonly HiveSession[]
  readonly nextCursor?: string | undefined
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
