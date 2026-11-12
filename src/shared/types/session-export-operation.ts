import type { SchemaType } from '@shared/schema'
import type {
  exportCancelCommandSchema,
  exportCancelOutcomeSchema,
  exportCreateCommandSchema,
  exportCreateOutcomeSchema,
  exportListQuerySchema,
  exportReadQuerySchema,
  exportResourceInputSchema,
  exportWaitQuerySchema,
} from '@shared/schemas/session-export-operation'
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
export const SESSION_EXPORT_RESOURCE_LIMIT = 256
export const SESSION_EXPORT_RESOURCE_BYTES_LIMIT = 256 * 1024 * 1024
export const SESSION_EXPORT_GLOBAL_CONCURRENCY_LIMIT = 4
export const SESSION_EXPORT_PROFILE_CONCURRENCY_LIMIT = 2

export type SessionExportFormat = (typeof SESSION_EXPORT_FORMATS)[number]
export type SessionExportOperationStatus = (typeof SESSION_EXPORT_OPERATION_STATUSES)[number]

export type SessionExportResourceInput = SchemaType<typeof exportResourceInputSchema>

export type SessionExportCreateCommand = SchemaType<typeof exportCreateCommandSchema>

export type SessionExportCancelCommand = SchemaType<typeof exportCancelCommandSchema>

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

export type SessionExportCreateOutcome = SchemaType<typeof exportCreateOutcomeSchema>

export type SessionExportCancelOutcome = SchemaType<typeof exportCancelOutcomeSchema>

export type SessionExportControlOutcome = SessionExportCreateOutcome | SessionExportCancelOutcome

export type SessionExportOperationQuery =
  | SchemaType<typeof exportListQuerySchema>
  | SchemaType<typeof exportReadQuerySchema>
  | SchemaType<typeof exportWaitQuerySchema>

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
