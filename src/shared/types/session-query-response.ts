import type { SessionHostEventCursor } from './session-host-event'
import type { SessionQueryOutcome } from './session-query'

export interface SessionQueryResponse {
  readonly contractVersion: 2
  readonly requestId: string
  readonly eventCursor?: SessionHostEventCursor
  readonly outcome: SessionQueryOutcome
}
