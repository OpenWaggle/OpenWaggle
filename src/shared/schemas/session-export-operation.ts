import { Schema } from '@shared/schema'
import type {
  SessionExportBundleManifest,
  SessionExportManifest,
} from '@shared/types/session-export'
import type { SessionExportResourceInput } from '@shared/types/session-export-operation'
import {
  SESSION_EXPORT_FORMATS,
  SESSION_EXPORT_OPERATION_QUERY_LIMIT,
  SESSION_EXPORT_OPERATION_STATUSES,
} from '@shared/types/session-export-operation'
import {
  SESSION_QUERY_MAX_CURSOR_LENGTH,
  SESSION_QUERY_MAX_PATH_LENGTH,
} from '@shared/types/session-query'
import { SESSION_QUERY_MAX_WAIT_MS } from '@shared/types/session-wait'

const boundedPath = Schema.String.pipe(Schema.maxLength(SESSION_QUERY_MAX_PATH_LENGTH))
const boundedCursor = Schema.String.pipe(Schema.maxLength(SESSION_QUERY_MAX_CURSOR_LENGTH))

export const exportResourceInputSchema = Schema.Struct({
  kind: Schema.Literal('workspace-file'),
  path: boundedPath,
})

export const exportResourcesSchema: Schema.Schema<readonly SessionExportResourceInput[]> =
  Schema.Array(exportResourceInputSchema)

export const sessionExportManifestSchema: Schema.Schema<SessionExportManifest> = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sessionId: Schema.String,
  title: Schema.String,
  branchScope: Schema.Literal('active-branch', 'tree'),
  activeBranchId: Schema.NullOr(Schema.String),
  selectedBranchId: Schema.NullOr(Schema.String),
  snapshot: Schema.Struct({
    nodeHighWaterMark: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    stateRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    queueRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    capturedAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  }),
  activeRunId: Schema.NullOr(Schema.String),
  activeTurnIncomplete: Schema.Boolean,
  queue: Schema.Struct({
    state: Schema.Literal('running', 'paused'),
    pendingCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    bodyScope: Schema.Literal('included', 'omitted-by-choice'),
    omittedBodyCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    items: Schema.Array(
      Schema.Struct({
        followUpId: Schema.String,
        position: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
        createdAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
        deliveryState: Schema.Literal('pending', 'needs_attention'),
        attentionReason: Schema.optional(
          Schema.Literal('authorization_ceiling_changed', 'profile_revoked', 'authority_changed'),
        ),
        intent: Schema.optional(Schema.Unknown),
      }),
    ),
  }),
})

export const sessionExportBundleManifestSchema: Schema.Schema<SessionExportBundleManifest> =
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    kind: Schema.Literal('openwaggle-session-export-bundle'),
    export: sessionExportManifestSchema,
    entries: Schema.Array(
      Schema.Struct({
        path: boundedPath,
        mediaType: Schema.String,
        size: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
        sha256: Schema.String,
      }),
    ),
  })

export const exportCreateCommandSchema = Schema.Struct({
  operation: Schema.Literal('export-create'),
  sessionId: Schema.String,
  format: Schema.Literal(...SESSION_EXPORT_FORMATS),
  destinationPath: boundedPath,
  destinationRoot: Schema.optional(boundedPath),
  overwriteExisting: Schema.optional(Schema.Boolean),
  branchScope: Schema.optional(Schema.Literal('active-branch', 'tree')),
  branchId: Schema.optional(Schema.String),
  includeQueueBodies: Schema.optional(Schema.Boolean),
  resources: Schema.optional(Schema.Array(exportResourceInputSchema)),
})

export const exportCancelCommandSchema = Schema.Struct({
  operation: Schema.Literal('export-cancel'),
  sessionId: Schema.String,
  exportOperationId: Schema.String,
})

export const exportOperationStatusSchema = Schema.Literal(...SESSION_EXPORT_OPERATION_STATUSES)

export const exportOperationErrorSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
})

export const exportCreateOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('export-create'),
  effect: Schema.Literal('export-accepted'),
  sessionId: Schema.String,
  exportOperationId: Schema.String,
  status: exportOperationStatusSchema,
})

export const exportCancelOutcomeSchema = Schema.Struct({
  operation: Schema.Literal('export-cancel'),
  effect: Schema.Literal('export-cancellation-requested'),
  sessionId: Schema.String,
  exportOperationId: Schema.String,
  status: exportOperationStatusSchema,
})

export const exportListQuerySchema = Schema.Struct({
  operation: Schema.Literal('exports-list'),
  sessionId: Schema.String,
  limit: Schema.Number.pipe(Schema.int(), Schema.between(1, SESSION_EXPORT_OPERATION_QUERY_LIMIT)),
  cursor: Schema.optional(boundedCursor),
  statuses: Schema.optional(Schema.Array(exportOperationStatusSchema).pipe(Schema.minItems(1))),
})

export const exportReadQuerySchema = Schema.Struct({
  operation: Schema.Literal('exports-read'),
  sessionId: Schema.String,
  exportOperationId: Schema.String,
})

export const exportWaitQuerySchema = Schema.Struct({
  operation: Schema.Literal('exports-wait'),
  sessionId: Schema.String,
  exportOperationId: Schema.String,
  timeoutMs: Schema.Number.pipe(Schema.int(), Schema.between(0, SESSION_QUERY_MAX_WAIT_MS)),
  after: Schema.optional(
    Schema.Struct({
      hostInstanceId: Schema.String,
      sequence: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    }),
  ),
})
