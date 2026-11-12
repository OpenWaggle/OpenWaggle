import type { SchemaType } from '@shared/schema'
import type {
  sessionExportBranchScopeSchema,
  sessionExportManifestSchema,
} from '@shared/schemas/session-export-operation'

export const SESSION_EXPORT_SCHEMA_VERSION = 1 as const
export const SESSION_EXPORT_BUNDLE_SCHEMA_VERSION = 1 as const

export type SessionExportBranchScope = SchemaType<typeof sessionExportBranchScopeSchema>

export type SessionExportManifest = SchemaType<typeof sessionExportManifestSchema>

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
