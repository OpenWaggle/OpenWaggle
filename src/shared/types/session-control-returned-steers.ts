import { MAX_FOLLOW_UP_QUEUE_ITEMS } from './session-control-queue'

/**
 * How many direct steers one Run may hold that it could hand back as Follow-ups if it stops
 * before incorporating them. A direct steer is admitted only while the queue has room, so a queue
 * that receives a stopped Run's steers never exceeds `MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS`.
 */
export const MAX_RETURNED_STEER_OVERFLOW = 64

/** The most Follow-ups a queue can hold, counting steers a stopped Run returned past capacity. */
export const MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS =
  MAX_FOLLOW_UP_QUEUE_ITEMS + MAX_RETURNED_STEER_OVERFLOW
