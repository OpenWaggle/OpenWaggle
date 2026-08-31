import { decodeUnknownExactOrThrow, parseJsonUnknown } from '@shared/schema'
import {
  exportOperationErrorSchema,
  exportResourcesSchema,
  sessionExportManifestSchema,
} from '@shared/schemas/session-export-operation'
import type {
  SessionExportFormat,
  SessionExportOperationStatus,
  SessionExportOperationSummary,
} from '@shared/types/session-export-operation'
import type { SessionExportOperationRecord } from '../ports/session-export-operation-repository'

export interface SessionExportOperationRow {
  readonly id: string
  readonly caller_id: string
  readonly session_id: string
  readonly idempotency_key: string
  readonly format: SessionExportFormat
  readonly destination_path: string
  readonly destination_root: string | null
  readonly resource_source_root: string | null
  readonly temporary_path: string
  readonly overwrite_existing: number
  readonly branch_scope: 'active-branch' | 'tree'
  readonly branch_id: string | null
  readonly include_queue_bodies: number
  readonly resources_json: string
  readonly status: SessionExportOperationStatus
  readonly manifest_json: string | null
  readonly artifact_sha256: string | null
  readonly artifact_size_bytes: number | null
  readonly records_written: number
  readonly resources_written: number
  readonly bytes_written: number
  readonly cancel_requested: number
  readonly execution_token: string | null
  readonly cleanup_pending: number
  readonly error_json: string | null
  readonly created_at: number
  readonly updated_at: number
  readonly completed_at: number | null
}

function parseResources(value: string) {
  return decodeUnknownExactOrThrow(exportResourcesSchema, parseJsonUnknown(value))
}

function parseManifest(value: string | null) {
  return value
    ? decodeUnknownExactOrThrow(sessionExportManifestSchema, parseJsonUnknown(value))
    : undefined
}

function parseError(value: string | null) {
  return value
    ? decodeUnknownExactOrThrow(exportOperationErrorSchema, parseJsonUnknown(value))
    : undefined
}

export function sessionExportOperationRecord(
  row: SessionExportOperationRow,
): SessionExportOperationRecord {
  const manifest = parseManifest(row.manifest_json)
  const error = parseError(row.error_json)
  return {
    exportOperationId: row.id,
    callerId: row.caller_id,
    sessionId: row.session_id,
    idempotencyKey: row.idempotency_key,
    format: row.format,
    destinationPath: row.destination_path,
    ...(row.destination_root ? { destinationRoot: row.destination_root } : {}),
    ...(row.resource_source_root ? { resourceSourceRoot: row.resource_source_root } : {}),
    temporaryPath: row.temporary_path,
    overwriteExisting: row.overwrite_existing === 1,
    status: row.status,
    branchScope: row.branch_scope,
    ...(row.branch_id ? { branchId: row.branch_id } : {}),
    includeQueueBodies: row.include_queue_bodies === 1,
    resources: parseResources(row.resources_json),
    progress: {
      recordsWritten: row.records_written,
      resourcesWritten: row.resources_written,
      bytesWritten: row.bytes_written,
    },
    cancelRequested: row.cancel_requested === 1,
    cleanupPending: row.cleanup_pending === 1,
    ...(row.artifact_sha256 && row.artifact_size_bytes !== null
      ? {
          artifactReceipt: {
            sha256: row.artifact_sha256,
            sizeBytes: row.artifact_size_bytes,
          },
        }
      : {}),
    ...(manifest ? { manifest } : {}),
    ...(error ? { error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  }
}

export function sessionExportOperationSummary(
  record: SessionExportOperationRecord,
): SessionExportOperationSummary {
  return {
    exportOperationId: record.exportOperationId,
    sessionId: record.sessionId,
    format: record.format,
    destinationPath: record.destinationPath,
    status: record.status,
    branchScope: record.branchScope,
    ...(record.branchId ? { branchId: record.branchId } : {}),
    includeQueueBodies: record.includeQueueBodies,
    resources: record.resources,
    progress: record.progress,
    ...(record.manifest ? { manifest: record.manifest } : {}),
    ...(record.error ? { error: record.error } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.completedAt === undefined ? {} : { completedAt: record.completedAt }),
  }
}
