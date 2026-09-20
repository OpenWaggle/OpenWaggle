import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { tryGetSessionHostEventRuntime } from '../session-host/session-host-events'
import { cancelSessionRuns } from './active-session-runs'

export function fenceFailedClaimedSessionOperation(sessionId: string) {
  return Effect.sync(() => {
    cancelSessionRuns(SessionId(sessionId))
    tryGetSessionHostEventRuntime()?.liveness.requestDrain('recovery')
  })
}
