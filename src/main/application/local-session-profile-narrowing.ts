import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileAuthority,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import type { SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import {
  LocalSessionCommandAuthorizationError,
  type SessionAuthorizationTargetRepositoryError,
} from '../errors'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { isPathInside } from '../utils/paths'

/**
 * `openwaggle mcp serve --profile <name>` authenticates as the named access profile and sends the
 * server's own `--grant`, `--workspace`, `--session`, `--export-root`, and `--attachment-root`
 * as a narrowing (#350). The caller then holds what both allow: never more than the profile.
 *
 * A scope is a union of projects, Sessions, and hives, so the intersection of two scopes has no
 * exact scope of its own. It is built from what both admit now: profile projects inside the
 * server's workspaces (new Sessions there stay reachable), plus every existing Session both
 * scopes admit. A hive grant becomes the members both admit; a Worker started later in that
 * hive is reached from the next connection, and the MCP server opens one for every call.
 */
export function narrowNamedProfileCaller(
  caller: LocalSessionCallerIdentity,
): Effect.Effect<
  LocalSessionCallerIdentity,
  LocalSessionCommandAuthorizationError | SessionAuthorizationTargetRepositoryError,
  SessionAuthorizationTargetRepository
> {
  const narrowing = caller.profileNarrowing
  if (!narrowing) return Effect.succeed(caller)
  return Effect.gen(function* () {
    const authority = caller.profileAuthority
    if (!authority) return yield* denied('A narrowed MCP caller needs a named profile.')
    if (!hasExplicitTargetScope(narrowing.scope)) {
      return yield* denied(
        'An MCP server narrowing needs an explicit --workspace or --session scope.',
      )
    }
    const profileScope = caller.baseProfileScope ?? authority.scope
    const targets = yield* intersectTargets(profileScope, narrowing.scope)
    const exportRoots = narrowRoots(profileScope.exportRoots, narrowing.scope.exportRoots)
    const attachmentRoots = narrowRoots(
      profileScope.attachmentRoots,
      narrowing.scope.attachmentRoots,
    )
    const scope: LocalSessionProfileScope = {
      ...(targets.projectPaths.length > 0 ? { projectPaths: targets.projectPaths } : {}),
      ...(targets.sessionIds.length > 0 ? { sessionIds: targets.sessionIds } : {}),
      ...(exportRoots.length > 0 ? { exportRoots } : {}),
      ...(attachmentRoots.length > 0 ? { attachmentRoots } : {}),
    }
    const { derivedSessionAuthorities, ...rest } = caller
    return {
      ...rest,
      profileAuthority: {
        profileId: authority.profileId,
        profileName: authority.profileName,
        capabilities: intersect(authority.capabilities, narrowing.capabilities),
        scope,
        authorizationCeiling: lowerCeiling(
          authority.authorizationCeiling,
          narrowing.authorizationCeiling,
        ),
      },
      baseProfileScope: scope,
      ...(derivedSessionAuthorities
        ? {
            derivedSessionAuthorities: narrowDerived(
              derivedSessionAuthorities,
              narrowing,
              targets.reachableSessionIds,
            ),
          }
        : {}),
    } satisfies LocalSessionCallerIdentity
  })
}

function hasExplicitTargetScope(scope: LocalSessionProfileScope) {
  if (scope.all === true || scope.hiveRootSessionIds !== undefined) return false
  return (scope.workspaceRoots?.length ?? 0) > 0 || (scope.sessionIds?.length ?? 0) > 0
}

/** The projects and existing Sessions both scopes admit. */
function intersectTargets(
  profileScope: LocalSessionProfileScope,
  narrowingScope: LocalSessionProfileScope,
) {
  return Effect.gen(function* () {
    const repository = yield* SessionAuthorizationTargetRepository
    const { listAuthorizedSessionIds, resolveWorkspaceProjectPaths } = repository
    if (!listAuthorizedSessionIds || !resolveWorkspaceProjectPaths) {
      return yield* denied('This Session Host cannot intersect a profile with an MCP server scope.')
    }
    const roots = narrowingScope.workspaceRoots ?? []
    const explicitSessionIds = narrowingScope.sessionIds ?? []
    const rootProjects = roots.length > 0 ? yield* resolveWorkspaceProjectPaths(roots) : []
    const narrowingProjects = unique([...(narrowingScope.projectPaths ?? []), ...rootProjects])
    const reachableSessionIds = new Set(
      yield* listAuthorizedSessionIds({
        projectPaths: narrowingProjects,
        sessionIds: explicitSessionIds,
      }),
    )
    if (profileScope.all) {
      return {
        projectPaths: narrowingProjects,
        sessionIds: explicitSessionIds,
        reachableSessionIds,
      }
    }
    const profileSessionIds = yield* listAuthorizedSessionIds(profileScope)
    return {
      projectPaths: (profileScope.projectPaths ?? []).filter(
        (projectPath) =>
          narrowingProjects.includes(projectPath) ||
          roots.some((root) => isPathInside(root, projectPath)),
      ),
      sessionIds: unique(profileSessionIds.filter((id) => reachableSessionIds.has(id))),
      reachableSessionIds,
    }
  })
}

function narrowDerived(
  derived: NonNullable<LocalSessionCallerIdentity['derivedSessionAuthorities']>,
  narrowing: LocalSessionProfileAuthority,
  reachableSessionIds: ReadonlySet<string>,
) {
  return derived
    .filter((entry) => reachableSessionIds.has(entry.sessionId))
    .map((entry) => ({
      sessionId: entry.sessionId,
      capabilities: intersect(entry.capabilities, narrowing.capabilities),
      authorizationCeiling: lowerCeiling(
        entry.authorizationCeiling,
        narrowing.authorizationCeiling,
      ),
    }))
}

function denied(detail: string) {
  return Effect.fail(
    new LocalSessionCommandAuthorizationError({ code: 'target_scope_denied', detail }),
  )
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)]
}

function intersect<T extends string | SessionCapability>(left: readonly T[], right: readonly T[]) {
  const allowed = new Set(right)
  return unique(left.filter((value) => allowed.has(value)))
}

/** A server root counts only inside one of the profile's roots; no profile roots, no roots. */
function narrowRoots(
  profileRoots: readonly string[] | undefined,
  serverRoots: readonly string[] | undefined,
) {
  if (serverRoots === undefined) return profileRoots ?? []
  return unique(
    serverRoots.filter((root) =>
      (profileRoots ?? []).some((profileRoot) => isPathInside(profileRoot, root)),
    ),
  )
}

function lowerCeiling(
  left: AgentAuthorizationMode,
  right: AgentAuthorizationMode,
): AgentAuthorizationMode {
  return left === 'yolo' && right === 'yolo' ? 'yolo' : 'ask-for-approval'
}
