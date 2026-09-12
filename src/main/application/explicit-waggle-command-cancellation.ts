import { SessionId } from '@shared/types/brand'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import {
  type LocalSessionCommandPayload,
  SESSION_WAGGLE_CONTRACT_VERSION,
} from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import {
  authorizeExplicitWaggleCaller,
  cancelLocalExplicitWaggle,
} from './explicit-waggle-command-service'

type SessionWaggleCancelPayload = Extract<
  LocalSessionCommandPayload,
  { contract: 'session-waggle-cancel-v1' }
>

export function executeExplicitWaggleCancellation(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: SessionWaggleCancelPayload
}) {
  return authorizeExplicitWaggleCaller(input.caller).pipe(
    Effect.zipRight(
      Effect.sync(() => {
        const request = input.payload.request
        return {
          contract: 'session-waggle-cancel-v1',
          response: {
            contractVersion: SESSION_WAGGLE_CONTRACT_VERSION,
            requestId: request.requestId,
            sessionId: request.sessionId,
            cancelled: cancelLocalExplicitWaggle(SessionId(request.sessionId)),
          },
        } as const
      }),
    ),
  )
}
