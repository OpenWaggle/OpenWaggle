import {
  type AgentAuthorizationScopeKey,
  authorizationScopeKeyId,
  findMatchingGrant,
  type ScopedAuthorizationGrant,
} from '@shared/types/agent-authorization-grants'
import type { SessionId } from '@shared/types/brand'
import {
  grantProjectAuthorization,
  listProjectAuthorizationGrants,
  revokeProjectAuthorization,
} from '../config/project-config'
import { createLogger } from '../logger'

const logger = createLogger('agent-authorization-grants')

/**
 * Session-scoped grants.
 *
 * In memory only, mirroring Codex's `sess.services.tool_approvals`. A session grant must not outlive
 * the session, so persisting it would quietly turn "allow for this session" into "allow forever".
 */
const sessionGrants = new Map<SessionId, Map<string, ScopedAuthorizationGrant>>()

/** Records a grant for the rest of this session only. */
export function grantForSession(
  sessionId: SessionId,
  key: AgentAuthorizationScopeKey,
  grantedAt = Date.now(),
): void {
  const existing = sessionGrants.get(sessionId) ?? new Map<string, ScopedAuthorizationGrant>()
  existing.set(authorizationScopeKeyId(key), {
    requester: key.requester,
    capability: key.capability,
    ...(key.resource === undefined ? {} : { resource: key.resource }),
    grantedAt,
  })
  sessionGrants.set(sessionId, existing)
}

/** Every session grant held for a session. */
export function listSessionGrants(sessionId: SessionId): readonly ScopedAuthorizationGrant[] {
  return [...(sessionGrants.get(sessionId)?.values() ?? [])]
}

/** Drops a session's grants, for session deletion and for tests. */
export function clearSessionGrants(sessionId?: SessionId): void {
  if (sessionId === undefined) {
    sessionGrants.clear()
    return
  }
  sessionGrants.delete(sessionId)
}

export type AuthorizationGrantSource = 'session' | 'project'

export interface MatchedAuthorizationGrant {
  readonly source: AuthorizationGrantSource
  readonly grant: ScopedAuthorizationGrant
}

/**
 * Finds a grant that already covers a request, session scope first.
 *
 * Reads project grants from disk on every call rather than caching, so a revoke in Settings takes
 * effect on the very next request. Caching would make revocation quietly lag behind the UI that
 * claims it happened.
 */
export async function findGrantCovering(input: {
  readonly sessionId: SessionId
  readonly projectPath: string | null
  readonly key: AgentAuthorizationScopeKey
}): Promise<MatchedAuthorizationGrant | undefined> {
  const sessionMatch = findMatchingGrant(listSessionGrants(input.sessionId), input.key)
  if (sessionMatch) return { source: 'session', grant: sessionMatch }

  if (!input.projectPath) return undefined

  try {
    const projectMatch = findMatchingGrant(
      await listProjectAuthorizationGrants(input.projectPath),
      input.key,
    )
    return projectMatch ? { source: 'project', grant: projectMatch } : undefined
  } catch (cause) {
    // An unreadable project config must not be read as "granted".
    logger.warn('Failed to read project authorization grants; treating as no grant', {
      projectPath: input.projectPath,
      error: cause instanceof Error ? cause.message : String(cause),
    })
    return undefined
  }
}

/** Persists a grant for the project, surviving restarts until revoked. */
export async function grantForProject(
  projectPath: string,
  key: AgentAuthorizationScopeKey,
): Promise<void> {
  await grantProjectAuthorization(projectPath, key)
}

/** Removes a persisted project grant. Applies from the next request, never retroactively. */
export async function revokeForProject(
  projectPath: string,
  key: AgentAuthorizationScopeKey,
): Promise<void> {
  await revokeProjectAuthorization(projectPath, key)
}

/** Every persisted grant for a project, for the Settings list. */
export async function listGrantsForProject(
  projectPath: string,
): Promise<readonly ScopedAuthorizationGrant[]> {
  return listProjectAuthorizationGrants(projectPath)
}
