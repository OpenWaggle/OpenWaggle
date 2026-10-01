import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import type { SessionControlFollowUp, SessionControlSessionState } from '../message-aggregate'

export const USER = 'gui:local-user'
export const AGENT = 'session-agent:queen:run-1'
export const SESSION_ID = SessionId('session-edit')
export const NEXT_RUN = RunId('run-next')
export const HOLD = {
  holdId: 'hold-1',
  holderCallerId: USER,
  acquiredAt: 1_000,
  expiresAt: 31_000,
  baseQueueRevision: 4,
} as const

export function followUp(
  id: string,
  overrides: Partial<SessionControlFollowUp['intent']> = {},
  item: Partial<SessionControlFollowUp> = {},
): SessionControlFollowUp {
  return {
    id: FollowUpId(id),
    deliveryState: 'pending',
    intent: {
      text: `Text of ${id}`,
      attachmentIds: [],
      thinkingLevel: 'high',
      runAuthorizationOverride: 'ask-for-approval',
      callerId: USER,
      acceptedAt: 500,
      idempotencyKey: `key-${id}`,
      ...overrides,
    },
    ...item,
  }
}

export function state(
  items: readonly SessionControlFollowUp[],
  run: SessionControlSessionState['run'] = { state: 'active', runId: RunId('run-active') },
  queueState: 'running' | 'paused' = 'running',
  queue: Partial<SessionControlSessionState['followUpQueue']> = {},
): SessionControlSessionState {
  return {
    sessionId: SESSION_ID,
    revision: 10,
    run,
    followUpQueue: { state: queueState, revision: 4, items, ...queue },
  }
}

export const IDLE = { state: 'idle' } as const
