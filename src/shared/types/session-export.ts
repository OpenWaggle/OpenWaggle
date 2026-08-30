export const SESSION_EXPORT_SCHEMA_VERSION = 1 as const
export const SESSION_EXPORT_BUNDLE_SCHEMA_VERSION = 1 as const

export type SessionExportBranchScope = 'active-branch' | 'tree'

export interface SessionExportQuery {
  readonly operation: 'export'
  readonly sessionId: string
  readonly limit: number
  readonly branchScope?: SessionExportBranchScope
  readonly branchId?: string
  readonly includeQueueBodies?: boolean
  readonly afterCreatedOrder?: number
  readonly throughCreatedOrder?: number
  readonly snapshotStateRevision?: number
  readonly capturedAt?: number
}

export interface SessionExportManifest {
  readonly schemaVersion: typeof SESSION_EXPORT_SCHEMA_VERSION
  readonly sessionId: string
  readonly title: string
  readonly branchScope: SessionExportBranchScope
  readonly activeBranchId: string | null
  readonly selectedBranchId: string | null
  readonly snapshot: {
    readonly nodeHighWaterMark: number
    readonly stateRevision: number
    readonly queueRevision: number
    readonly capturedAt: number
  }
  readonly activeRunId: string | null
  readonly activeTurnIncomplete: boolean
  readonly queue: {
    readonly state: 'running' | 'paused'
    readonly pendingCount: number
    readonly bodyScope: 'included' | 'omitted-by-choice'
    readonly omittedBodyCount: number
    readonly items: readonly {
      readonly followUpId: string
      readonly position: number
      readonly createdAt: number
      readonly deliveryState: 'pending' | 'needs_attention'
      readonly attentionReason?:
        | 'authorization_ceiling_changed'
        | 'profile_revoked'
        | 'authority_changed'
      readonly intent?: unknown
    }[]
  }
}

export interface SessionExportBundleEntry {
  readonly path: string
  readonly mediaType: string
  readonly size: number
  readonly sha256: string
}

export interface SessionExportBundleManifest {
  readonly schemaVersion: typeof SESSION_EXPORT_BUNDLE_SCHEMA_VERSION
  readonly kind: 'openwaggle-session-export-bundle'
  readonly export: SessionExportManifest
  readonly entries: readonly SessionExportBundleEntry[]
}

export interface SessionExportNodeRecord {
  readonly record: 'node'
  readonly schemaVersion: typeof SESSION_EXPORT_SCHEMA_VERSION
  readonly sessionId: string
  readonly nodeId: string
  readonly parentNodeId: string | null
  readonly branchHintId: string | null
  readonly role: string | null
  readonly kind: string
  readonly timestampMs: number
  readonly createdOrder: number
  readonly runId?: string
  readonly content: unknown
  readonly metadata: unknown
}

export interface SessionExportOutcome {
  readonly operation: 'export'
  readonly manifest: SessionExportManifest
  readonly records: readonly SessionExportNodeRecord[]
  readonly nextCreatedOrder?: number
}
