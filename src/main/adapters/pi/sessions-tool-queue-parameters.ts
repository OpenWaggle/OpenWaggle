import { MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS } from '@shared/types/session-control-returned-steers'
import { Type } from 'typebox'

const queueRevision = Type.Integer({ minimum: 0 })

export const sessionsToolQueueParameters = [
  Type.Object({
    action: Type.Literal('queue_withdraw'),
    sessionId: Type.String(),
    followUpIds: Type.Array(Type.String(), {
      minItems: 1,
      maxItems: MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS,
      uniqueItems: true,
    }),
  }),
  Type.Object({
    action: Type.Literal('queue_reorder'),
    sessionId: Type.String(),
    followUpIds: Type.Array(Type.String(), {
      maxItems: MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS,
      uniqueItems: true,
    }),
    queueRevision,
  }),
  Type.Object({
    action: Type.Union([Type.Literal('queue_pause'), Type.Literal('queue_resume')]),
    sessionId: Type.String(),
    queueRevision,
  }),
] as const
