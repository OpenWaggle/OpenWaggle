import type {
  LocalSessionClientFrame,
  LocalSessionServerFrame,
} from '@shared/types/local-session-protocol'
import * as Cause from 'effect/Cause'
import * as Option from 'effect/Option'
import * as Runtime from 'effect/Runtime'
import { disconnectLocalSessionProfile } from './local-session-profile-invalidation'
import type {
  AuthenticatedLocalSessionCaller,
  LocalSessionServerDependencies,
} from './local-session-server'
import { describeLocalSessionServerError, invalidatedProfileId } from './local-session-server-frame'

function commandFailure(error: unknown) {
  const failure = Runtime.isFiberFailure(error)
    ? Option.getOrUndefined(Cause.failureOption(error[Runtime.FiberFailureCauseId]))
    : error
  if (typeof failure !== 'object' || failure === null) {
    return { code: 'command_failed', retryable: false }
  }
  return {
    code: 'code' in failure && typeof failure.code === 'string' ? failure.code : 'command_failed',
    retryable: 'retryable' in failure && failure.retryable === true,
  }
}

export async function executeLocalSessionCommandFrame(input: {
  readonly frame: Extract<LocalSessionClientFrame, { kind: 'command' }>
  readonly caller: AuthenticatedLocalSessionCaller
  readonly negotiatedRevision: number
  readonly dependencies: LocalSessionServerDependencies
  readonly signal: AbortSignal
  readonly send: (frame: LocalSessionServerFrame) => Promise<void>
}) {
  const releaseOperation = input.dependencies.liveness.acquire('operation')
  try {
    const payload = await input.dependencies.dispatch({
      caller: input.caller,
      negotiatedRevision: input.negotiatedRevision,
      eventCursor: input.dependencies.eventHub.cursor(),
      payload: input.frame.payload,
      signal: input.signal,
    })
    await input.send({ kind: 'response', requestId: input.frame.requestId, payload })
    const invalidated = invalidatedProfileId(payload)
    if (invalidated) disconnectLocalSessionProfile(invalidated)
  } catch (error) {
    const failure = commandFailure(error)
    await input.send({
      kind: 'error',
      requestId: input.frame.requestId,
      code: failure.code,
      message: describeLocalSessionServerError(error),
      retryable: failure.retryable,
    })
  } finally {
    releaseOperation()
  }
}
