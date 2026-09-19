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

/** Read-only subset shared by the current projection and the Session Host catalog. */
export interface HiveLineage {
  readonly role: 'queen' | 'worker' | 'independent'
  readonly parentSessionId?: SessionId | null
  readonly directWorkerCount: number
  readonly activeDirectWorkerCount: number
  readonly agentDefinitionName?: string | null
  readonly delegationState?: HiveDelegationState | null
}

export interface HiveSession {
  readonly id: SessionId
  readonly title: string
  readonly archived?: boolean
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
