import type { SessionId } from '@shared/types/brand'
import { queryOptions, type UseQueryOptions } from '@tanstack/react-query'
import { readQueue } from './session-follow-up-queue-client'
import { EMPTY_SNAPSHOT, type SessionFollowUpQueueSnapshot } from './session-follow-up-queue-model'
import {
  FOLLOW_UP_QUEUE_READ_RETRIES,
  followUpQueueRecoveryInterval,
  followUpQueueRetryDelay,
} from './session-follow-up-queue-read-policy'

function sessionFollowUpQueueKey(sessionId: SessionId | string) {
  return ['session-control', 'queue', String(sessionId)] as const
}

type SessionFollowUpQueueKey = readonly ['session-control', 'queue', string | null]

export function sessionFollowUpQueueOptions(
  sessionId: SessionId | null,
): UseQueryOptions<
  SessionFollowUpQueueSnapshot,
  Error,
  SessionFollowUpQueueSnapshot,
  SessionFollowUpQueueKey
> {
  return queryOptions({
    queryKey: sessionId
      ? (sessionFollowUpQueueKey(sessionId) satisfies SessionFollowUpQueueKey)
      : (['session-control', 'queue', null] as const),
    queryFn: () => (sessionId ? readQueue(sessionId) : Promise.resolve(EMPTY_SNAPSHOT)),
    enabled: sessionId !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: FOLLOW_UP_QUEUE_READ_RETRIES,
    retryDelay: followUpQueueRetryDelay,
    refetchInterval: followUpQueueRecoveryInterval,
  })
}
