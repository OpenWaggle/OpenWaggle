import { SESSION_EXPORT_OPERATION_QUERY_LIMIT } from '@shared/types/session-export-operation'
import { SESSION_QUERY_MAX_WAIT_MS } from '@shared/types/session-query'
import { Type } from 'typebox'

export const sessionsToolExportOperationParameters = [
  Type.Object({
    action: Type.Literal('export_create'),
    sessionId: Type.String(),
    destinationPath: Type.String({ minLength: 1 }),
    format: Type.Optional(
      Type.Union([Type.Literal('jsonl'), Type.Literal('markdown'), Type.Literal('bundle')]),
    ),
    branchScope: Type.Optional(Type.Union([Type.Literal('active-branch'), Type.Literal('tree')])),
    branchId: Type.Optional(Type.String()),
    includeQueueBodies: Type.Optional(Type.Boolean()),
    overwriteExisting: Type.Optional(Type.Boolean()),
    resources: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
  }),
  Type.Object({
    action: Type.Literal('export_cancel'),
    sessionId: Type.String(),
    exportOperationId: Type.String(),
    idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
  }),
  Type.Object({
    action: Type.Literal('exports_list'),
    sessionId: Type.String(),
    statuses: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Literal('queued'),
          Type.Literal('running'),
          Type.Literal('cancelling'),
          Type.Literal('completed'),
          Type.Literal('failed'),
          Type.Literal('cancelled'),
        ]),
        { minItems: 1 },
      ),
    ),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: SESSION_EXPORT_OPERATION_QUERY_LIMIT }),
    ),
    cursor: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal('exports_read'),
    sessionId: Type.String(),
    exportOperationId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal('exports_wait'),
    sessionId: Type.String(),
    exportOperationId: Type.String(),
    timeoutMs: Type.Integer({ minimum: 0, maximum: SESSION_QUERY_MAX_WAIT_MS }),
    after: Type.Optional(
      Type.Object({
        hostInstanceId: Type.String(),
        sequence: Type.Integer({ minimum: 0 }),
      }),
    ),
  }),
] as const
