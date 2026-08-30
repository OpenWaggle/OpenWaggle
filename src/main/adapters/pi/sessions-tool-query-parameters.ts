import {
  SESSION_QUERY_DISCOVERY_LIMIT,
  SESSION_QUERY_TRANSCRIPT_LIMIT,
} from '@shared/types/session-query'
import { Type } from 'typebox'

export const sessionsToolReadParameters = [
  Type.Object({
    action: Type.Union([
      Type.Literal('read'),
      Type.Literal('status'),
      Type.Literal('queue_list'),
      Type.Literal('requests_list'),
    ]),
    sessionId: Type.String(),
    includeBodies: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    action: Type.Literal('turns'),
    sessionId: Type.String(),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SESSION_QUERY_DISCOVERY_LIMIT })),
    cursor: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal('items'),
    sessionId: Type.String(),
    runId: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SESSION_QUERY_TRANSCRIPT_LIMIT })),
    afterCreatedOrder: Type.Optional(Type.Integer({ minimum: 0 })),
    throughCreatedOrder: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
  Type.Object({
    action: Type.Literal('export'),
    sessionId: Type.String(),
    branchScope: Type.Optional(Type.Union([Type.Literal('active-branch'), Type.Literal('tree')])),
    branchId: Type.Optional(Type.String()),
    includeQueueBodies: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SESSION_QUERY_TRANSCRIPT_LIMIT })),
    afterCreatedOrder: Type.Optional(Type.Integer({ minimum: 0 })),
    throughCreatedOrder: Type.Optional(Type.Integer({ minimum: 0 })),
    snapshotStateRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    capturedAt: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
] as const
