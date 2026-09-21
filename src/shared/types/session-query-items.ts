export interface SessionItemsQuery {
  readonly operation: 'items'
  readonly sessionId: string
  readonly limit: number
  readonly runId?: string
  readonly branchScope?: 'active-branch' | 'tree'
  readonly branchId?: string
  readonly afterCreatedOrder?: number
  readonly throughCreatedOrder?: number
  readonly snapshotHeadNodeId?: string
}

export interface SessionItemsOutcome {
  readonly operation: 'items'
  readonly sessionId: string
  readonly items: readonly {
    readonly nodeId: string
    readonly parentNodeId: string | null
    readonly role: string | null
    readonly kind: string
    readonly timestampMs: number
    readonly createdOrder: number
    readonly branchHintId: string | null
    readonly runId?: string
    readonly content: unknown
    readonly metadata: unknown
  }[]
  readonly highWaterMark: number
  readonly branchScope: 'active-branch' | 'tree'
  readonly selectedBranchId: string | null
  readonly snapshotHeadNodeId: string | null
  readonly nextCreatedOrder?: number
}
