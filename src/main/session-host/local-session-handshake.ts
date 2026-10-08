import type { Socket } from 'node:net'
import { decodeLocalSessionClientHello } from '@shared/schemas/local-session-protocol'
import * as Cause from 'effect/Cause'
import * as Option from 'effect/Option'
import * as Runtime from 'effect/Runtime'
import { negotiateLocalSessionProtocol } from './local-session-negotiation'
import {
  type LocalSessionAuthenticationBudget,
  LocalSessionGlobalAuthenticationThrottledError,
} from './local-session-resource-policy'
import type {
  AuthenticatedLocalSessionCaller,
  LocalSessionServerDependencies,
} from './local-session-server'

/** The failure code only; the error may carry the presented credential. */
function authenticationFailureCode(error: unknown) {
  const failure: unknown = Runtime.isFiberFailure(error)
    ? Option.getOrUndefined(Cause.failureOption(error[Runtime.FiberFailureCauseId]))
    : error
  const code: unknown =
    typeof failure === 'object' && failure !== null ? Reflect.get(failure, 'code') : undefined
  return typeof code === 'string' ? code : 'unknown'
}

export interface LocalSessionAuthenticationFailure {
  /** For the Host log only. */
  readonly reason: string
  readonly code: 'authentication_failed' | 'authentication_throttled'
  readonly message: string
  readonly retryable: boolean
}

/**
 * How the Host answers a failed authentication. Why it failed stays in the Host log: telling an
 * unauthenticated peer whether a profile exists or was revoked would let it probe for profile
 * names. The Host-wide throttle is the exception. It reveals nothing about the presented profile,
 * and the GUI's own connection must not treat a throttle that another local client tripped as
 * final, so it is reported as retryable. The per-profile throttle stays an ordinary failure.
 */
function describeAuthenticationFailure(error: unknown): LocalSessionAuthenticationFailure {
  if (error instanceof LocalSessionGlobalAuthenticationThrottledError) {
    return {
      reason: 'global_throttle',
      code: 'authentication_throttled',
      message: error.message,
      retryable: true,
    }
  }
  return {
    reason: authenticationFailureCode(error),
    code: 'authentication_failed',
    message: 'Local Session authentication failed.',
    retryable: false,
  }
}

interface LocalSessionHandshakeInput {
  readonly value: unknown
  readonly socket: Socket
  readonly dependencies: LocalSessionServerDependencies
  readonly budget: LocalSessionAuthenticationBudget
  readonly signal: AbortSignal
  readonly send: (frame: unknown) => Promise<void>
  readonly authenticationFailed: (failure: LocalSessionAuthenticationFailure) => Promise<void>
}

async function authenticate(
  input: LocalSessionHandshakeInput,
  hello: ReturnType<typeof decodeLocalSessionClientHello>,
) {
  return input.budget.run({
    ...(hello.profile ? { key: hello.profile } : {}),
    signal: input.signal,
    authenticate: () => input.dependencies.authenticate(hello, input.socket),
  })
}

export async function establishLocalSessionHandshake(input: LocalSessionHandshakeInput): Promise<
  | { readonly status: 'closed' }
  | {
      readonly status: 'accepted'
      readonly caller: AuthenticatedLocalSessionCaller
      readonly revision: number
      readonly negotiation: unknown
    }
> {
  const hello = decodeLocalSessionClientHello(input.value)
  const preliminary = negotiateLocalSessionProtocol(hello, input.dependencies.hostInstanceId)
  if (!preliminary.accepted && preliminary.code === 'incompatible_protocol') {
    await input.send(preliminary)
    input.socket.end()
    return { status: 'closed' }
  }
  let caller: AuthenticatedLocalSessionCaller
  try {
    caller = await authenticate(input, hello)
  } catch (error) {
    await input.authenticationFailed(describeAuthenticationFailure(error))
    return { status: 'closed' }
  }
  if (!preliminary.accepted) {
    const mayRequestUpgrade =
      caller.callerId === 'gui:local-user' || caller.callerId.startsWith('local-user:')
    if (!mayRequestUpgrade) {
      await input.send({
        accepted: false,
        protocol: preliminary.protocol,
        code: 'incompatible_protocol',
        supportedRevisions: preliminary.supportedRevisions,
      })
      input.socket.end()
      return { status: 'closed' }
    }
    const blockers = (await input.dependencies.describeUpgradeBlockers?.()) ?? {
      blockingRuns: [],
      blockingOperations: [],
    }
    await input.send(
      negotiateLocalSessionProtocol(hello, input.dependencies.hostInstanceId, blockers),
    )
    input.socket.end()
    input.dependencies.requestUpgradeDrain?.()
    return { status: 'closed' }
  }
  return {
    status: 'accepted',
    caller,
    revision: preliminary.revision,
    negotiation: preliminary,
  }
}
