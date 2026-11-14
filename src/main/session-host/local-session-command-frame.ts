import {
  type SessionHostErrorKind,
  sessionHostErrorKindForThrownCode,
} from '@shared/domain/session-host-refusals'
import type { LocalSessionClientFrame } from '@shared/types/local-session-client-frame'
import type { LocalSessionServerFrame } from '@shared/types/local-session-protocol'
import type { SessionHostEventCursor } from '@shared/types/session-host-event'
import * as Cause from 'effect/Cause'
import * as Option from 'effect/Option'
import * as Runtime from 'effect/Runtime'
import { isAdmittedWhileDraining } from './local-session-drain-admission'
import { localSessionErrorFrameCode } from './local-session-error-frame'
import type { LocalSessionCursorResolution } from './local-session-event-cursor-projection'
import {
  disconnectLocalSessionProfile,
  refreshLocalSessionProfileAdmissions,
} from './local-session-profile-invalidation'
import type {
  AuthenticatedLocalSessionCaller,
  LocalSessionServerDependencies,
} from './local-session-server'
import {
  describeLocalSessionServerError,
  invalidatedProfileId,
  refreshedProfileId,
} from './local-session-server-frame'
import { sessionCommandFailureMessage } from './session-command-failure-message'

const INVALIDATION_RESPONSE_DELIVERY_GRACE_MS = 250

async function settleInvalidationResponse(response: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const outcome = await Promise.race([
    response.then(
      () => ({ status: 'sent' as const }),
      (error: unknown) => ({ status: 'failed' as const, error }),
    ),
    new Promise<{ readonly status: 'pending' }>((resolve) => {
      timer = setTimeout(
        () => resolve({ status: 'pending' }),
        INVALIDATION_RESPONSE_DELIVERY_GRACE_MS,
      )
      timer.unref?.()
    }),
  ])
  if (timer) clearTimeout(timer)
  return outcome
}

/**
 * The code and kind of a thrown failure (ADR 0063). The kind is always the refusal table's for
 * the code, and a code it does not list is `internal`.
 */
function commandFailure(error: unknown) {
  const failure = Runtime.isFiberFailure(error)
    ? Option.getOrUndefined(Cause.failureOption(error[Runtime.FiberFailureCauseId]))
    : error
  if (typeof failure !== 'object' || failure === null) {
    return { ...localSessionErrorFrameCode('command_failed'), retryable: false } satisfies {
      readonly code: string
      readonly errorKind: SessionHostErrorKind
      readonly retryable: boolean
    }
  }
  const code =
    'code' in failure && typeof failure.code === 'string' ? failure.code : 'command_failed'
  // The kind is the table's for the code, never one the failure claims (ADR 0063).
  return {
    code,
    errorKind: sessionHostErrorKindForThrownCode(code),
    retryable: 'retryable' in failure && failure.retryable === true,
  } satisfies {
    readonly code: string
    readonly errorKind: SessionHostErrorKind
    readonly retryable: boolean
  }
}

export async function executeLocalSessionCommandFrame(input: {
  readonly frame: Extract<LocalSessionClientFrame, { kind: 'command' }>
  readonly caller: AuthenticatedLocalSessionCaller
  readonly negotiatedRevision: number
  readonly dependencies: LocalSessionServerDependencies
  readonly eventCursor: SessionHostEventCursor
  readonly resolveEventCursor: (cursor: SessionHostEventCursor) => LocalSessionCursorResolution
  readonly exposeEventCursor: (cursor: SessionHostEventCursor) => SessionHostEventCursor
  readonly signal: AbortSignal
  readonly send: (frame: LocalSessionServerFrame) => Promise<void>
  readonly releaseAdmissionReader?: () => void
}) {
  let releaseOperation: () => void
  try {
    releaseOperation = input.dependencies.liveness.acquire('operation', {
      whileDraining:
        input.dependencies.liveness.isDraining() && isAdmittedWhileDraining(input.frame.payload),
    })
  } catch (error) {
    // A stopping Host refuses this one request; the connection stays usable.
    input.releaseAdmissionReader?.()
    await input.send({
      kind: 'error',
      requestId: input.frame.requestId,
      ...localSessionErrorFrameCode('host_draining'),
      message: describeLocalSessionServerError(error),
      retryable: true,
    })
    return
  }
  try {
    let payload: unknown
    try {
      payload = await input.dependencies.dispatch({
        caller: input.caller,
        negotiatedRevision: input.negotiatedRevision,
        eventCursor: input.eventCursor,
        resolveEventCursor: input.resolveEventCursor,
        exposeEventCursor: input.exposeEventCursor,
        payload: input.frame.payload,
        signal: input.signal,
        releaseAdmissionReader: () => input.releaseAdmissionReader?.(),
        requestHostStop: (options) => {
          input.dependencies.liveness.requestDrain('stop', options)
          return {
            hostInstanceId: input.dependencies.hostInstanceId,
            runningActions: input.dependencies.liveness.ownerCount('action-run'),
          }
        },
      })
      input.releaseAdmissionReader?.()
      const refreshed = refreshedProfileId(payload)
      if (refreshed) await refreshLocalSessionProfileAdmissions(refreshed)
    } catch (error) {
      input.releaseAdmissionReader?.()
      const failure = commandFailure(error)
      await input.send({
        kind: 'error',
        requestId: input.frame.requestId,
        code: failure.code,
        errorKind: failure.errorKind,
        message: sessionCommandFailureMessage(error),
        retryable: failure.retryable,
      })
      return
    }

    const invalidated = invalidatedProfileId(payload)
    const response = input.send({ kind: 'response', requestId: input.frame.requestId, payload })
    if (!invalidated) {
      await response
      return
    }
    const responseOutcome = await settleInvalidationResponse(response)
    disconnectLocalSessionProfile(invalidated)
    if (responseOutcome.status === 'failed') throw responseOutcome.error
    if (responseOutcome.status === 'pending') void response.catch(() => undefined)
  } finally {
    input.releaseAdmissionReader?.()
    releaseOperation()
  }
}
