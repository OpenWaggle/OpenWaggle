import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileAuthority,
} from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Runtime from 'effect/Runtime'
import { requiredSessionQueryCapabilities } from '../domain/session-control/session-capability-authorization'
import type { LocalSessionProfileRepository } from '../ports/local-session-profile-repository'
import type { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { SessionQueryRepository } from '../ports/session-query-repository'
import { SessionWaitService } from '../ports/session-wait-service'
import type { SettingsService } from '../services/settings-service'
import { listPendingAgentLoopInteractions } from './agent-loop-interaction-broker'
import {
  authorizeLocalSessionCommand,
  profileAuthorityForCapabilities,
  refreshNamedProfileCaller,
} from './local-session-command-authorization'

function authorizeSessionQueryObservation(
  caller: LocalSessionCallerIdentity,
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-query-v2' }>,
) {
  return Effect.gen(function* () {
    const refreshedCaller = yield* refreshNamedProfileCaller(caller)
    yield* authorizeLocalSessionCommand({ caller: refreshedCaller, payload })
    return profileAuthorityForCapabilities(
      refreshedCaller,
      requiredSessionQueryCapabilities(payload.request.query),
    )
  })
}

async function observationAuthorityFromExit(
  exit: Exit.Exit<LocalSessionProfileAuthority | undefined, unknown>,
) {
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.failureOption(exit.cause)
  if (Option.isSome(failure)) throw failure.value
  throw Cause.squash(exit.cause)
}

function abortSignalEffect(signal: AbortSignal): Effect.Effect<never, Error> {
  return Effect.async<never, Error>((resume) => {
    const abort = () => {
      const reason: unknown = signal.reason
      resume(
        Effect.fail(
          reason instanceof Error ? reason : new Error('Local Session query was cancelled.'),
        ),
      )
    }
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    return Effect.sync(() => signal.removeEventListener('abort', abort))
  })
}

function observeWithSignal<A, E, R>(effect: Effect.Effect<A, E, R>, signal?: AbortSignal) {
  return signal ? Effect.raceFirst(effect, abortSignalEffect(signal)) : effect
}

function isFreshnessBlockingSearch(
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-query-v2' }>,
) {
  const query = payload.request.query
  return (
    query.operation === 'search' &&
    query.mode !== 'lexical' &&
    query.requireFresh === true &&
    (query.waitTimeoutMs ?? 0) > 0
  )
}

export function dispatchSessionWaitQuery(
  caller: LocalSessionCallerIdentity,
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-query-v2' }>,
  signal?: AbortSignal,
) {
  return Effect.gen(function* () {
    const query = payload.request.query
    if (query.operation !== 'wait' && query.operation !== 'exports-wait') {
      return yield* Effect.fail(new Error('Expected a long-running Session query.'))
    }
    const service = yield* SessionWaitService
    const runtime = yield* Effect.runtime<
      LocalSessionProfileRepository | SessionAuthorizationTargetRepository | SettingsService
    >()
    const runAuthorization = Runtime.runPromiseExit(runtime)
    const resolveObservationAuthority = () =>
      runAuthorization(authorizeSessionQueryObservation(caller, payload)).then(
        observationAuthorityFromExit,
      )
    const response =
      query.operation === 'wait'
        ? yield* service.wait({
            resolveObservationAuthority,
            ...(signal ? { signal } : {}),
            request: { ...payload.request, query },
          })
        : yield* service.waitForExport({
            resolveObservationAuthority,
            ...(signal ? { signal } : {}),
            request: { ...payload.request, query },
          })
    return { contract: 'session-query-v2', response } as const
  })
}

function canListInteraction(caller: LocalSessionCallerIdentity, interaction: AgentLoopInteraction) {
  const capabilities = caller.profileAuthority?.capabilities
  if (!capabilities) return true
  const required =
    interaction.kind === 'confirm' && interaction.purpose === 'authorization'
      ? 'sessions:approve'
      : 'sessions:respond'
  return capabilities.includes(required)
}

function listRequests(
  caller: LocalSessionCallerIdentity,
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-query-v2' }>,
) {
  const query = payload.request.query
  if (query.operation !== 'requests-list') {
    throw new Error('Expected a requests-list Session query.')
  }
  return Effect.succeed({
    contract: 'session-query-v2',
    response: {
      contractVersion: payload.request.contractVersion,
      requestId: payload.request.requestId,
      outcome: {
        operation: 'requests-list',
        sessionId: query.sessionId,
        requests: listPendingAgentLoopInteractions().filter(
          (interaction) =>
            interaction.sessionId === query.sessionId && canListInteraction(caller, interaction),
        ),
      },
    },
  } as const)
}

export function dispatchSessionRepositoryQuery(
  caller: LocalSessionCallerIdentity,
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-query-v2' }>,
  signal?: AbortSignal,
) {
  const operation = Effect.gen(function* () {
    const repository = yield* SessionQueryRepository
    let authority = profileAuthorityForCapabilities(
      caller,
      requiredSessionQueryCapabilities(payload.request.query),
    )
    const execute = (request: typeof payload.request) =>
      repository.execute({
        callerId: caller.callerId,
        ...(authority ? { authority } : {}),
        request,
      })
    let response = yield* execute(payload.request)
    if (caller.callerId.startsWith('profile:') && isFreshnessBlockingSearch(payload)) {
      authority = yield* authorizeSessionQueryObservation(caller, payload)
      const query = payload.request.query
      if (query.operation !== 'search') {
        return yield* Effect.die('Freshness-blocking query changed operation unexpectedly.')
      }
      response = yield* execute({
        ...payload.request,
        query: { ...query, requireFresh: false, waitTimeoutMs: 0 },
      })
    }
    return { contract: 'session-query-v2', response } as const
  })
  return observeWithSignal(operation, signal)
}

export function dispatchSessionQuery(
  caller: LocalSessionCallerIdentity,
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-query-v2' }>,
  signal?: AbortSignal,
) {
  if (payload.request.query.operation === 'requests-list') return listRequests(caller, payload)
  if (
    payload.request.query.operation === 'wait' ||
    payload.request.query.operation === 'exports-wait'
  ) {
    return dispatchSessionWaitQuery(caller, payload, signal)
  }
  return dispatchSessionRepositoryQuery(caller, payload, signal)
}
