import type { SessionExportBranchScope, SessionExportManifest } from './session-export'
import type { SessionHostEventCursor } from './session-host-event'

export const SESSION_EXPORT_FORMATS = ['jsonl', 'markdown', 'bundle'] as const
export const SESSION_EXPORT_OPERATION_STATUSES = [
  'queued',
  'running',
  'installing',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
] as const
export const SESSION_EXPORT_OPERATION_QUERY_LIMIT = 200

export type SessionExportFormat = (typeof SESSION_EXPORT_FORMATS)[number]
export type SessionExportOperationStatus = (typeof SESSION_EXPORT_OPERATION_STATUSES)[number]

export interface SessionExportResourceInput {
  readonly kind: 'workspace-file'
  readonly path: string
}

export interface SessionExportCreateCommand {
  readonly operation: 'export-create'
  readonly sessionId: string
  readonly format: SessionExportFormat
  readonly destinationPath: string
  /** Canonical root injected by a scoped adapter; never populated from user-facing CLI flags. */
  readonly destinationRoot?: string
  readonly overwriteExisting?: boolean
  readonly branchScope?: SessionExportBranchScope
  readonly branchId?: string
  readonly includeQueueBodies?: boolean
  readonly resources?: readonly SessionExportResourceInput[]
}

export interface SessionExportCancelCommand {
  readonly operation: 'export-cancel'
  readonly sessionId: string
  readonly exportOperationId: string
}

export type SessionExportControlCommand = SessionExportCreateCommand | SessionExportCancelCommand

export interface SessionExportProgress {
  readonly recordsWritten: number
  readonly resourcesWritten: number
  readonly bytesWritten: number
}

export interface SessionExportOperationSummary {
  readonly exportOperationId: string
  readonly sessionId: string
  readonly format: SessionExportFormat
  readonly destinationPath: string
  readonly status: SessionExportOperationStatus
  readonly branchScope: SessionExportBranchScope
  readonly branchId?: string
  readonly includeQueueBodies: boolean
  readonly resources: readonly SessionExportResourceInput[]
  readonly progress: SessionExportProgress
  readonly manifest?: SessionExportManifest
  readonly error?: { readonly code: string; readonly message: string }
  readonly createdAt: number
  readonly updatedAt: number
  readonly completedAt?: number
}

export interface SessionExportCreateOutcome {
  readonly operation: 'export-create'
  readonly effect: 'export-accepted'
  readonly sessionId: string
  readonly exportOperationId: string
  readonly status: SessionExportOperationStatus
}

export interface SessionExportCancelOutcome {
  readonly operation: 'export-cancel'
  readonly effect: 'export-cancellation-requested'
  readonly sessionId: string
  readonly exportOperationId: string
  readonly status: SessionExportOperationStatus
}

export type SessionExportControlOutcome = SessionExportCreateOutcome | SessionExportCancelOutcome

export type SessionExportOperationQuery =
  | {
      readonly operation: 'exports-list'
      readonly sessionId: string
      readonly limit: number
      readonly cursor?: string
      readonly statuses?: readonly SessionExportOperationStatus[]
    }
  | {
      readonly operation: 'exports-read'
      readonly sessionId: string
      readonly exportOperationId: string
    }
  | {
      readonly operation: 'exports-wait'
      readonly sessionId: string
      readonly exportOperationId: string
      readonly timeoutMs: number
      readonly after?: SessionHostEventCursor
    }

export type SessionExportOperationQueryOutcome =
  | {
      readonly operation: 'exports-list'
      readonly sessionId: string
      readonly exports: readonly SessionExportOperationSummary[]
      readonly nextCursor?: string
    }
  | {
      readonly operation: 'exports-read'
      readonly export: SessionExportOperationSummary
    }
  | {
      readonly operation: 'exports-wait'
      readonly timedOut: boolean
      readonly cursor: SessionHostEventCursor
      readonly export: SessionExportOperationSummary
    }
