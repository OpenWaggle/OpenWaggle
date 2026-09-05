import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import type { SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import { authorizeSessionTargetForCaller } from '../domain/session-control/session-capability-authorization'
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

function refreshEventAdmissionSessionIds(caller: LocalSessionCallerIdentity) {
  const authority = caller.profileAuthority
  if (!authority) return Effect.succeed(caller)
  const scope = caller.baseProfileScope ?? authority.scope
  if (scope.all) {
    const { eventAdmissionSessionIds: _, ...withoutSnapshot } = caller
    return Effect.succeed(withoutSnapshot)
  }
  return Effect.gen(function* () {
    const repository = yield* SessionAuthorizationTargetRepository
    const authorizedSessionIds = repository.listAuthorizedSessionIds
      ? yield* repository.listAuthorizedSessionIds(scope)
      : (scope.sessionIds ?? [])
    return { ...caller, eventAdmissionSessionIds: [...new Set(authorizedSessionIds)] }
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
            profile.scope,
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
    Effect.flatMap(refreshEventAdmissionSessionIds),
  )
}

function hasEveryCapability(
  available: readonly SessionCapability[],
  required: readonly SessionCapability[],
) {
  const availableCapabilities = new Set(available)
  return required.every((capability) => availableCapabilities.has(capability))
}

function projectedSessionIds(
  caller: LocalSessionCallerIdentity,
  baseScope: LocalSessionProfileScope,
  required: readonly SessionCapability[],
  includeBaseScope: boolean,
) {
  const sessionIds = new Set(includeBaseScope ? (baseScope.sessionIds ?? []) : [])
  for (const derived of caller.derivedSessionAuthorities ?? []) {
    if (hasEveryCapability(derived.capabilities, required)) sessionIds.add(derived.sessionId)
  }
  return [...sessionIds]
}

function fileScopeFrom(baseScope: LocalSessionProfileScope): LocalSessionProfileScope {
  return {
    ...(baseScope.workspaceRoots ? { workspaceRoots: baseScope.workspaceRoots } : {}),
    ...(baseScope.exportRoots ? { exportRoots: baseScope.exportRoots } : {}),
    ...(baseScope.attachmentRoots ? { attachmentRoots: baseScope.attachmentRoots } : {}),
  }
}

function targetScopeFrom(
  baseScope: LocalSessionProfileScope,
  includeBaseScope: boolean,
): LocalSessionProfileScope {
  if (!includeBaseScope) return {}
  return {
    ...(baseScope.all !== undefined ? { all: baseScope.all } : {}),
    ...(baseScope.projectPaths ? { projectPaths: baseScope.projectPaths } : {}),
    ...(baseScope.hiveRootSessionIds ? { hiveRootSessionIds: baseScope.hiveRootSessionIds } : {}),
  }
}

export function profileAuthorityForCapabilities(
  caller: LocalSessionCallerIdentity,
  required: readonly SessionCapability[],
) {
  const authority = caller.profileAuthority
  if (!authority) return undefined
  const baseScope = caller.baseProfileScope ?? authority.scope
  const baseHasCapabilities = hasEveryCapability(authority.capabilities, required)
  const sessionIds = projectedSessionIds(caller, baseScope, required, baseHasCapabilities)
  return {
    ...authority,
    scope: {
      ...fileScopeFrom(baseScope),
      ...targetScopeFrom(baseScope, baseHasCapabilities),
      ...(sessionIds.length > 0 ? { sessionIds } : {}),
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
  return authorizeSessionTargetForCaller(caller, target, required)
}
