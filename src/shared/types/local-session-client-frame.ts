import type { SessionHostEventCursor } from './session-host-event'

export type LocalSessionClientFrame =
  | {
      readonly kind: 'command'
      readonly requestId: string
      readonly payload: unknown
    }
  | {
      readonly kind: 'subscribe'
      readonly requestId: string
      readonly after?: SessionHostEventCursor
      readonly sessionIds?: readonly string[]
    }
  | {
      readonly kind: 'unsubscribe'
      readonly requestId: string
      readonly subscriptionId: string
    }
