import type { DelegationState } from './session-collaboration'

export type SessionLineageRole = 'queen' | 'worker' | 'independent'
export type SessionDiscoveryMode = 'hybrid' | 'lexical' | 'semantic'

export interface SessionDiscoveryEvidence {
  readonly matchKind: 'exact' | 'lexical' | 'semantic' | 'hybrid'
  readonly matchedFields: readonly (
    | 'title'
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

export interface SemanticDiscoveryReadiness {
  readonly status: 'ready' | 'partial' | 'preparing' | 'unavailable' | 'failed'
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
  readonly directWorkerCount: number
  readonly agentDefinitionName?: string
  readonly delegationId?: string
  readonly delegationState?: DelegationState
  readonly discoveryEvidence?: SessionDiscoveryEvidence
}
