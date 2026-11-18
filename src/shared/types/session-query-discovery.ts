import type { HiveNextActor } from './hive-next-actor'
import type { DelegationState } from './session-collaboration'

export type SessionLineageRole = 'queen' | 'worker' | 'independent'
export type SessionDiscoveryMode = 'hybrid' | 'lexical' | 'semantic'

export interface SessionDiscoveryEvidence {
  readonly matchKind: 'exact' | 'lexical' | 'semantic' | 'hybrid'
  readonly matchedFields: readonly (
    | 'title'
    | 'project'
    | 'objective'
    | 'initial-objective'
    | 'current-preview'
    | 'transcript'
  )[]
  readonly snippet?: string
  readonly rank: number
  readonly transcriptMatch?: {
    readonly nodeId: string
    readonly runId?: string
    readonly createdOrder: number
  }
}

/**
 * The Session embedding model when it cannot embed yet: the app fetches it on first use, so until
 * its files arrive semantic discovery is not usable and search matches words only.
 */
export interface SemanticDiscoveryModelAvailability {
  readonly state: 'missing' | 'downloading' | 'offline' | 'failed'
  readonly receivedBytes?: number
  readonly totalBytes?: number
  readonly reason?: string
  /** Epoch ms after which the next use tries the download again. */
  readonly retryAt?: number
}

export interface SemanticDiscoveryReadiness {
  readonly status: 'ready' | 'partial' | 'preparing' | 'unavailable' | 'failed'
  /** Present while the embedding model is not on disk yet. */
  readonly model?: SemanticDiscoveryModelAvailability
  readonly modelId?: string
  readonly modelRevision?: string
  readonly snapshotRevision?: number
  readonly coverage?: number
  readonly pendingCount?: number
  readonly updatedAt?: number
  readonly reason?: string
  readonly preparationOperationId?: string
  readonly coverageLimit?: {
    readonly reason:
      | 'per-session-node-limit'
      | 'storage-budget'
      | 'per-session-node-limit-and-storage-budget'
    readonly searchableNodeCount: number
    readonly eligibleNodeCount: number
    readonly preparedNodeCount: number
    readonly perSessionNodeLimit: number
  }
}

export interface SessionQuerySummary {
  readonly sessionId: string
  readonly title: string
  readonly projectPath: string | null
  readonly archived: boolean
  readonly createdAt: number
  readonly updatedAt: number
  readonly lineageRole: SessionLineageRole
  readonly parentSessionId?: string
  readonly hiveRootSessionId?: string
  /** Spawn depth in the Hive: 0 for a root Session. Absent for historical lineage. */
  readonly depth?: number
  readonly directWorkerCount: number
  readonly agentDefinitionName?: string
  readonly delegationId?: string
  readonly delegationState?: DelegationState
  /**
   * Who acts next on this Worker (ADR 0059): `user`, `parent`, `worker` or `none`. Present
   * whenever `delegationState` is, derived at read time by the rule the Hive panel uses.
   */
  readonly nextActor?: HiveNextActor
  /** Historical MCP ancestry does not grant Session Host delegation authority. */
  readonly historical?: boolean
  readonly discoveryEvidence?: SessionDiscoveryEvidence
}
