import { Type } from 'typebox'

const queueRevision = Type.Integer({ minimum: 0 })

export const sessionsToolQueueParameters = [
  Type.Object({
    action: Type.Literal('queue_withdraw'),
    sessionId: Type.String(),
    followUpIds: Type.Array(Type.String(), { minItems: 1 }),
  }),
  Type.Object({
    action: Type.Literal('queue_reorder'),
    sessionId: Type.String(),
    followUpIds: Type.Array(Type.String()),
    queueRevision,
  }),
  Type.Object({
    action: Type.Union([Type.Literal('queue_pause'), Type.Literal('queue_resume')]),
    sessionId: Type.String(),
    queueRevision,
  }),
  Type.Object({
    action: Type.Literal('queue_update_authorization'),
    sessionId: Type.String(),
    followUpId: Type.String(),
    authorization: Type.Union([
      Type.Literal('inherit'),
      Type.Literal('ask-for-approval'),
      Type.Literal('yolo'),
    ]),
  }),
] as const
