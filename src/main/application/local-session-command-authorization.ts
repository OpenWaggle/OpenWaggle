import { matchBy } from '@diegogbrisa/ts-match'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import {
  authorizeSessionCapabilities,
  requiredSessionControlCapabilities,
  requiredSessionLifecycleCapabilities,
  requiredSessionQueryCapabilities,
} from '../domain/session-control/session-capability-authorization'
import { LocalSessionCommandAuthorizationError } from '../errors'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { SettingsService } from '../services/settings-service'
import {
  authorizeTargetForCaller,
  derivedAuthorityForTarget,
  type LocalSessionAuthorizationTarget,
} from './local-session-derived-authority'

export {
  profileAuthorityForCapabilities,
  refreshNamedProfileCaller,
} from './local-session-derived-authority'

type AuthorizedLocalSessionCommandPayload = Exclude<
  LocalSessionCommandPayload,
  { contract: 'local-ui-v1' | 'local-attachments-v1' }
>

function requestedRunAuthorizationOverride(payload: AuthorizedLocalSessionCommandPayload) {
  if (payload.contract === 'session-query-v2' || payload.contract === 'local-access-v1') return
  if (payload.contract === 'session-lifecycle-v2') {
    return matchBy(payload.request.command, 'operation')
      .with('create', 'fork', () => undefined)
      .with('launch', 'spawn', (command) => command.runAuthorizationOverride)
      .exhaustive()
  }
  return matchBy(payload.request.command, 'operation')
    .with(
      'start',
      'follow-up',
      'replace',
      'queue-update-authorization',
      (command) => command.runAuthorizationOverride ?? undefined,
    )
    .with(
      'message',
      'steer',
      'interrupt',
      'interrupt-descendants',
      'request-respond',
      'approval-respond',
      'authorization-set',
      'promote',
      'queue-withdraw',
      'queue-reorder',
      'queue-pause',
      'queue-resume',
      'report',
      'delegation-submit',
      'delegation-claim',
      'delegation-conflict-acknowledge',
      'delegation-dependency',
      'delegation-propose-amendment',
      'delegation-amend',
      'delegation-state',
      'delegation-request-revision',
      'delegation-accept',
      'delegation-reopen',
      'delegation-cancel',
      'delegation-verify',
      'export-cancel',
      'export-create',
      'rename',
      'archive',
      'unarchive',
      'handoff',
      () => undefined,
    )
    .exhaustive()
}

function authorizeCapabilities(
  caller: LocalSessionCallerIdentity,
  payload: AuthorizedLocalSessionCommandPayload,
) {
  if (payload.contract === 'local-access-v1') return Effect.void
  const required =
    payload.contract === 'session-control-v2'
      ? requiredSessionControlCapabilities(payload.request.command)
      : payload.contract === 'session-lifecycle-v2'
        ? requiredSessionLifecycleCapabilities(payload.request.command)
        : requiredSessionQueryCapabilities(payload.request.query)
  const authorization = authorizeSessionCapabilities(caller.profileAuthority, required)
  return authorization.authorized
    ? Effect.void
    : Effect.fail(
        new LocalSessionCommandAuthorizationError({
          code: authorization.code,
          missing: authorization.missing,
        }),
      )
}

function requiredCapabilities(payload: AuthorizedLocalSessionCommandPayload) {
  if (payload.contract === 'local-access-v1') return []
  return payload.contract === 'session-control-v2'
    ? requiredSessionControlCapabilities(payload.request.command)
    : payload.contract === 'session-lifecycle-v2'
      ? requiredSessionLifecycleCapabilities(payload.request.command)
      : requiredSessionQueryCapabilities(payload.request.query)
}

function targetAuthorizationCeiling(target: unknown) {
  if (typeof target !== 'object' || target === null || !('authorizationCeiling' in target)) return
  const ceiling = target.authorizationCeiling
  return ceiling === 'yolo' || ceiling === 'ask-for-approval' ? ceiling : undefined
}

function isAuthorizationTarget(target: unknown): target is LocalSessionAuthorizationTarget {
  return typeof target === 'object' && target !== null
}

function authorizationCeilingExceeded() {
  return Effect.fail(
    new LocalSessionCommandAuthorizationError({ code: 'authorization_ceiling_exceeded' }),
  )
}

function requestsForbiddenCeilingMutation(
  caller: LocalSessionCallerIdentity,
  payload: AuthorizedLocalSessionCommandPayload,
) {
  if (caller.profileAuthority?.authorizationCeiling !== 'ask-for-approval') return false
  if (payload.contract !== 'session-control-v2') return false
  const command = payload.request.command
  if (command.operation === 'authorization-set') {
    return command.authorizationMode !== 'ask-for-approval'
  }
  return command.operation === 'steer' || command.operation === 'promote'
}

function requestedCeilings(
  caller: LocalSessionCallerIdentity,
  target: unknown,
): readonly (string | undefined)[] {
  const targetCeiling = targetAuthorizationCeiling(target)
  const derivedCeiling = isAuthorizationTarget(target)
    ? derivedAuthorityForTarget(caller, target)?.authorizationCeiling
    : undefined
  return [caller.profileAuthority?.authorizationCeiling, targetCeiling, derivedCeiling]
}

function authorizeCeiling(
  caller: LocalSessionCallerIdentity,
  payload: AuthorizedLocalSessionCommandPayload,
  target: unknown,
) {
  if (requestsForbiddenCeilingMutation(caller, payload)) return authorizationCeilingExceeded()
  const requested = requestedRunAuthorizationOverride(payload)
  if (requested !== 'yolo') return Effect.void
  const targetCeiling = targetAuthorizationCeiling(target)
  const exceedsCeiling = requestedCeilings(caller, target).includes('ask-for-approval')
  if (exceedsCeiling) return authorizationCeilingExceeded()
  if (caller.profileAuthority || targetCeiling === 'yolo') return Effect.void
  return Effect.gen(function* () {
    const settings = yield* SettingsService
    const snapshot = yield* settings.get()
    if (snapshot.defaultAuthorizationMode !== 'yolo') {
      return yield* Effect.fail(
        new LocalSessionCommandAuthorizationError({ code: 'authorization_ceiling_exceeded' }),
      )
    }
  })
}

function resolveQueryTarget(
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-query-v2' }>,
) {
  return Effect.gen(function* () {
    const query = payload.request.query
    if (query.operation === 'delegations-list') return { projectPath: query.projectPath }
    if (query.operation === 'delegations-conflicts') {
      if (!query.delegationId) return { projectPath: query.projectPath }
      const repository = yield* SessionAuthorizationTargetRepository
      return yield* repository.resolveDelegation(query.delegationId)
    }
    if (query.operation === 'delegations-read') {
      const repository = yield* SessionAuthorizationTargetRepository
      return yield* repository.resolveDelegation(query.delegationId)
    }
    if (query.operation === 'list' || query.operation === 'search') {
      return { projectPath: query.projectPath }
    }
    if (query.operation === 'wait') return { sessionId: query.targets[0]?.sessionId }
    const repository = yield* SessionAuthorizationTargetRepository
    return yield* repository.resolve(query.sessionId)
  })
}

function resolveAuthorizationTarget(payload: AuthorizedLocalSessionCommandPayload) {
  if (payload.contract === 'local-access-v1') return Effect.succeed({})
  if (payload.contract === 'session-query-v2') return resolveQueryTarget(payload)
  return Effect.gen(function* () {
    const repository = yield* SessionAuthorizationTargetRepository
    if (payload.contract === 'session-control-v2') {
      return yield* repository.resolve(payload.request.command.sessionId)
    }
    if (payload.request.command.operation === 'fork') {
      return yield* repository.resolve(payload.request.command.sourceSessionId)
    }
    if (payload.request.command.operation === 'spawn') {
      return yield* repository.resolve(payload.request.command.parentSessionId)
    }
    return { projectPath: payload.request.command.projectPath }
  })
}

function authorizeWaitTargets(
  caller: LocalSessionCallerIdentity,
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-query-v2' }>,
) {
  if (payload.request.query.operation !== 'wait') return Effect.succeed(false)
  const query = payload.request.query
  return Effect.gen(function* () {
    const repository = yield* SessionAuthorizationTargetRepository
    for (const waitTarget of query.targets) {
      const target = yield* repository.resolve(waitTarget.sessionId)
      const authorization = authorizeTargetForCaller(
        caller,
        target,
        requiredSessionQueryCapabilities(query),
      )
      if (!authorization.authorized) {
        return yield* Effect.fail(
          new LocalSessionCommandAuthorizationError({ code: authorization.code }),
        )
      }
    }
    return true
  })
}

function isUnscopedDiscovery(payload: AuthorizedLocalSessionCommandPayload) {
  if (payload.contract !== 'session-query-v2') return false
  const query = payload.request.query
  return (
    (query.operation === 'list' ||
      query.operation === 'search' ||
      query.operation === 'delegations-list') &&
    query.projectPath === undefined
  )
}

export function authorizeLocalSessionCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: LocalSessionCommandPayload
}) {
  return Effect.gen(function* () {
    const payload = input.payload
    if (payload.contract === 'local-ui-v1' || payload.contract === 'local-attachments-v1') {
      return yield* Effect.fail(
        new LocalSessionCommandAuthorizationError({ code: 'capability_denied' }),
      )
    }
    yield* authorizeCapabilities(input.caller, payload)
    if (payload.contract === 'local-access-v1') return
    if (
      payload.contract === 'session-query-v2' &&
      (yield* authorizeWaitTargets(input.caller, payload))
    )
      return
    if (isUnscopedDiscovery(payload)) return
    const target = yield* resolveAuthorizationTarget(payload)
    yield* authorizeCeiling(input.caller, payload, target)
    const authorization = authorizeTargetForCaller(
      input.caller,
      target,
      requiredCapabilities(payload),
    )
    if (!authorization.authorized) {
      return yield* Effect.fail(
        new LocalSessionCommandAuthorizationError({ code: authorization.code }),
      )
    }
  })
}

export {
  authorizeLocalSessionActiveRun,
  authorizeLocalSessionEvent,
} from './local-session-event-authorization'
