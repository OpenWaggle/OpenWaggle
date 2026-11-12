import type { SchemaType } from '@shared/schema'
import type { sessionItemsQuerySchema } from '@shared/schemas/session-query'

export type SessionItemsQuery = SchemaType<typeof sessionItemsQuerySchema>

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
