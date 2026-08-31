import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import { authorizeSessionTarget } from '../domain/session-control/session-capability-authorization'
import {
  LocalSessionCommandAuthorizationError,
  type LocalSessionProfileRepositoryError,
  type SessionAuthorizationTargetRepositoryError,
} from '../errors'
import { LocalSessionProfileRepository } from '../ports/local-session-profile-repository'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { assertCanonicalDirectoryRoots } from '../utils/canonical-directory-roots'

export interface LocalSessionAuthorizationTarget {
  readonly projectPath?: string
  readonly sessionId?: string
  readonly hiveRootSessionId?: string
}

function expandTransientWorkspaceScope(caller: LocalSessionCallerIdentity) {
  const authority = caller.profileAuthority
  const roots = authority?.scope.workspaceRoots
  if (!authority || !roots?.length) return Effect.succeed(caller)
  return Effect.gen(function* () {
    const repository = yield* SessionAuthorizationTargetRepository
    if (!repository.resolveWorkspaceProjectPaths) {
      return yield* Effect.fail(
        new LocalSessionCommandAuthorizationError({ code: 'target_scope_denied' }),
      )
    }
    const projectPaths = yield* repository.resolveWorkspaceProjectPaths(roots)
    const expandedScope = {
      ...authority.scope,
      projectPaths: [...new Set([...(authority.scope.projectPaths ?? []), ...projectPaths])],
    }
    return {
      ...caller,
      baseProfileScope: expandedScope,
      profileAuthority: { ...authority, scope: expandedScope },
    } satisfies LocalSessionCallerIdentity
  })
}

type RefreshedProfileCallerEffect = Effect.Effect<
  LocalSessionCallerIdentity,
  | Error
  | LocalSessionCommandAuthorizationError
  | LocalSessionProfileRepositoryError
  | SessionAuthorizationTargetRepositoryError,
  LocalSessionProfileRepository | SessionAuthorizationTargetRepository
>

export function refreshNamedProfileCaller(
  caller: LocalSessionCallerIdentity,
): RefreshedProfileCallerEffect {
  const connectedAuthority = caller.profileAuthority
  const refreshed: RefreshedProfileCallerEffect =
    !connectedAuthority || !caller.callerId.startsWith('profile:')
      ? Effect.succeed(caller)
      : Effect.gen(function* () {
          const repository = yield* LocalSessionProfileRepository
          const targetRepository = yield* SessionAuthorizationTargetRepository
          const profile = yield* repository.findById(connectedAuthority.profileId)
          if (!profile) {
            return yield* Effect.fail(
              new LocalSessionCommandAuthorizationError({ code: 'profile_not_found' }),
            )
          }
          if (profile.revokedAt !== null) {
            return yield* Effect.fail(
              new LocalSessionCommandAuthorizationError({ code: 'profile_revoked' }),
            )
          }
          const derivedSessionAuthorities = yield* targetRepository.listLiveDerivedAuthorities(
            caller.callerId,
          )
          return {
            ...caller,
            baseProfileScope: profile.scope,
            derivedSessionAuthorities,
            profileAuthority: {
              profileId: profile.id,
              profileName: profile.name,
              capabilities: profile.capabilities,
              scope: profile.scope,
              authorizationCeiling: profile.authorizationCeiling,
              ...(profile.managementEnvelope
                ? { managementEnvelope: profile.managementEnvelope }
                : {}),
            },
          } satisfies LocalSessionCallerIdentity
        })
  return refreshed.pipe(
    Effect.flatMap((resolved: LocalSessionCallerIdentity) => {
      const scope = resolved.profileAuthority?.scope
      if (!scope) return Effect.succeed(resolved)
      const durableRoots = [...(scope.projectPaths ?? []), ...(scope.workspaceRoots ?? [])]
      if (durableRoots.length === 0) return Effect.succeed(resolved)
      return Effect.tryPromise({
        try: async () => {
          await assertCanonicalDirectoryRoots(durableRoots, 'Profile project root')
          return resolved
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
    }),
    Effect.flatMap(expandTransientWorkspaceScope),
  )
}

export function profileAuthorityForCapabilities(
  caller: LocalSessionCallerIdentity,
  required: readonly SessionCapability[],
) {
  const authority = caller.profileAuthority
  if (!authority) return undefined
  const baseScope = caller.baseProfileScope ?? authority.scope
  const sessionIds = new Set(baseScope.sessionIds ?? [])
  for (const derived of caller.derivedSessionAuthorities ?? []) {
    if (required.every((capability) => derived.capabilities.includes(capability))) {
      sessionIds.add(derived.sessionId)
    }
  }
  return {
    ...authority,
    scope: {
      ...baseScope,
      ...(sessionIds.size > 0 ? { sessionIds: [...sessionIds] } : {}),
    },
  }
}

export function derivedAuthorityForTarget(
  caller: LocalSessionCallerIdentity,
  target: { readonly sessionId?: string },
) {
  return target.sessionId
    ? caller.derivedSessionAuthorities?.find(
        (authority) => authority.sessionId === target.sessionId,
      )
    : undefined
}

export function authorizeTargetForCaller(
  caller: LocalSessionCallerIdentity,
  target: LocalSessionAuthorizationTarget,
  required: readonly SessionCapability[],
) {
  const baseAuthority =
    caller.profileAuthority && caller.baseProfileScope
      ? { ...caller.profileAuthority, scope: caller.baseProfileScope }
      : caller.profileAuthority
  const base = authorizeSessionTarget(baseAuthority, target)
  if (base.authorized) return base
  const derived = derivedAuthorityForTarget(caller, target)
  if (!derived) return base
  const missing = required.filter((capability) => !derived.capabilities.includes(capability))
  return missing.length === 0
    ? ({ authorized: true, derived } as const)
    : ({ authorized: false, code: 'capability_denied' as const, missing } as const)
}
