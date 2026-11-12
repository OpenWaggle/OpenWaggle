import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type {
  LocalSessionAuthorityLimits,
  LocalSessionCallerIdentity,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import {
  LocalSessionCommandAuthorizationError,
  type SessionAuthorizationTargetRepositoryError,
} from '../errors'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { isPathInside } from '../utils/paths'

/** The profile id a caller held only by its authority limits carries. */
export const AUTHORITY_LIMITS_PROFILE_ID = 'authority-limits'

/** Limits that allow nothing: what unreadable or missing limits fail closed to. */
export const NO_AUTHORITY_LIMITS: LocalSessionAuthorityLimits = {
  capabilities: [],
  scope: {},
  authorizationCeiling: 'ask-for-approval',
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)]
}

function intersectList(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): readonly string[] {
  const allowed = new Set(left ?? [])
  return unique((right ?? []).filter((value) => allowed.has(value)))
}

/** A limited root counts only inside one of the live roots; no live roots, no roots. */
function narrowRoots(live: readonly string[] | undefined, limits: readonly string[] | undefined) {
  if (limits === undefined) return []
  return unique(
    limits.filter((root) => (live ?? []).some((liveRoot) => isPathInside(liveRoot, root))),
  )
}

function nonEmpty(
  key: keyof LocalSessionProfileScope,
  values: readonly string[],
): Partial<LocalSessionProfileScope> {
  return values.length > 0 ? { [key]: values } : {}
}

function lowerCeiling(left: AgentAuthorizationMode, right: AgentAuthorizationMode) {
  return left === 'yolo' && right === 'yolo' ? ('yolo' as const) : ('ask-for-approval' as const)
}

function rootsOf(live: LocalSessionProfileScope, limits: LocalSessionProfileScope) {
  return {
    ...nonEmpty('exportRoots', narrowRoots(live.exportRoots, limits.exportRoots)),
    ...nonEmpty('attachmentRoots', narrowRoots(live.attachmentRoots, limits.attachmentRoots)),
  }
}

function targetsOf(scope: LocalSessionProfileScope): LocalSessionProfileScope {
  return {
    ...(scope.all === true ? { all: true } : {}),
    ...(scope.projectPaths ? { projectPaths: scope.projectPaths } : {}),
    ...(scope.sessionIds ? { sessionIds: scope.sessionIds } : {}),
    ...(scope.hiveRootSessionIds ? { hiveRootSessionIds: scope.hiveRootSessionIds } : {}),
  }
}

/**
 * What two listed scopes both name, compared entry by entry. A catalog-wide side admits whatever
 * the other lists. Used where no Session catalog is at hand, so a Session one side reaches only
 * through its project is dropped rather than guessed at (fail closed).
 */
export function intersectAuthorityScopes(
  left: LocalSessionProfileScope,
  right: LocalSessionProfileScope,
): LocalSessionProfileScope {
  const roots = rootsOf(left, right)
  if (left.all === true) return { ...targetsOf(right), ...roots }
  if (right.all === true) return { ...targetsOf(left), ...roots }
  return {
    ...nonEmpty('projectPaths', intersectList(left.projectPaths, right.projectPaths)),
    ...nonEmpty('sessionIds', intersectList(left.sessionIds, right.sessionIds)),
    ...nonEmpty(
      'hiveRootSessionIds',
      intersectList(left.hiveRootSessionIds, right.hiveRootSessionIds),
    ),
    ...roots,
  }
}

/** Limits that allow only what both allow; null stands for no limits at all. */
export function intersectAuthorityLimits(
  left: LocalSessionAuthorityLimits | null,
  right: LocalSessionAuthorityLimits | null,
): LocalSessionAuthorityLimits | null {
  if (!left) return right
  if (!right) return left
  const allowed = new Set(right.capabilities)
  return {
    capabilities: left.capabilities.filter((capability) => allowed.has(capability)),
    scope: intersectAuthorityScopes(left.scope, right.scope),
    authorizationCeiling: lowerCeiling(left.authorizationCeiling, right.authorizationCeiling),
  }
}

/**
 * The targets a live scope and the limits both reach, read from the Session catalog, as an MCP
 * server narrowing does: projects both list, plus every existing Session both scopes admit. A
 * Session the limits name stays reachable when the live scope reaches it through its project or
 * hive.
 */
function intersectReachableTargets(
  live: LocalSessionProfileScope,
  limits: LocalSessionProfileScope,
) {
  return Effect.gen(function* () {
    if (live.all === true) return targetsOf(limits)
    if (limits.all === true) return targetsOf(live)
    const repository = yield* SessionAuthorizationTargetRepository
    const list = repository.listAuthorizedSessionIds
    if (!list) {
      return yield* Effect.fail(
        new LocalSessionCommandAuthorizationError({
          code: 'target_scope_denied',
          detail: 'This Session Host cannot intersect a scope with authority limits.',
        }),
      )
    }
    const liveSessionIds = new Set(yield* list(targetsOf(live)))
    const limitedSessionIds = yield* list(targetsOf(limits))
    return {
      ...nonEmpty('projectPaths', intersectList(live.projectPaths, limits.projectPaths)),
      ...nonEmpty(
        'sessionIds',
        unique(limitedSessionIds.filter((sessionId) => liveSessionIds.has(sessionId))),
      ),
      ...nonEmpty(
        'hiveRootSessionIds',
        intersectList(live.hiveRootSessionIds, limits.hiveRootSessionIds),
      ),
    } satisfies LocalSessionProfileScope
  })
}

/**
 * Limits that allow only what both allow, intersected through the Session catalog so a Session
 * one side reaches through its project stays reachable; null stands for no limits at all.
 */
export function intersectReachableAuthorityLimits(
  left: LocalSessionAuthorityLimits | null,
  right: LocalSessionAuthorityLimits | null,
) {
  return Effect.gen(function* () {
    if (!left) return right
    if (!right) return left
    const targets = yield* intersectReachableTargets(left.scope, right.scope)
    const allowed = new Set(right.capabilities)
    return {
      capabilities: left.capabilities.filter((capability) => allowed.has(capability)),
      scope: { ...targets, ...rootsOf(left.scope, right.scope) },
      authorizationCeiling: lowerCeiling(left.authorizationCeiling, right.authorizationCeiling),
    } satisfies LocalSessionAuthorityLimits
  })
}

/**
 * The caller held to the limits alone: a caller with no named-profile authority (the local
 * user) takes them as its authority.
 */
function limitsAsAuthority(
  caller: LocalSessionCallerIdentity,
  limits: LocalSessionAuthorityLimits,
): LocalSessionCallerIdentity {
  const { derivedSessionAuthorities: _, eventAdmissionSessionIds: __, ...rest } = caller
  return {
    ...rest,
    profileAuthority: {
      profileId: AUTHORITY_LIMITS_PROFILE_ID,
      profileName: AUTHORITY_LIMITS_PROFILE_ID,
      capabilities: [...limits.capabilities],
      scope: limits.scope,
      authorizationCeiling: limits.authorizationCeiling,
    },
    baseProfileScope: limits.scope,
  }
}

/**
 * Holds a caller within its `authorityLimits`. The local user takes the limits as its authority;
 * a profile caller keeps what both its live profile and the limits allow. Derived Worker grants
 * are dropped: the limits stand for one Session agent's own authority, not for Sessions it
 * managed. Applying the limits again changes nothing.
 */
export function applyAuthorityLimits(
  caller: LocalSessionCallerIdentity,
): Effect.Effect<
  LocalSessionCallerIdentity,
  LocalSessionCommandAuthorizationError | SessionAuthorizationTargetRepositoryError,
  SessionAuthorizationTargetRepository
> {
  const limits = caller.authorityLimits
  if (!limits) return Effect.succeed(caller)
  const authority = caller.profileAuthority
  if (!authority || authority.profileId === AUTHORITY_LIMITS_PROFILE_ID) {
    return Effect.succeed(limitsAsAuthority(caller, limits))
  }
  return Effect.gen(function* () {
    const live = caller.baseProfileScope ?? authority.scope
    const targets = yield* intersectReachableTargets(live, limits.scope)
    const scope = { ...targets, ...rootsOf(live, limits.scope) }
    const allowed = new Set(limits.capabilities)
    const { derivedSessionAuthorities: _, eventAdmissionSessionIds: __, ...rest } = caller
    return {
      ...rest,
      profileAuthority: {
        profileId: authority.profileId,
        profileName: authority.profileName,
        capabilities: authority.capabilities.filter((capability) => allowed.has(capability)),
        scope,
        authorizationCeiling: lowerCeiling(
          authority.authorizationCeiling,
          limits.authorizationCeiling,
        ),
      },
      baseProfileScope: scope,
    } satisfies LocalSessionCallerIdentity
  })
}

/** The local user held to its limits, which needs no Session catalog. */
export function localUserWithinLimits(
  caller: LocalSessionCallerIdentity,
  limits: LocalSessionAuthorityLimits | null,
): LocalSessionCallerIdentity {
  return limits ? limitsAsAuthority({ ...caller, authorityLimits: limits }, limits) : caller
}
