import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import type { AuthenticatedLocalSessionCaller } from './local-session-server'

function requiresAsynchronousAdmission(scope: {
  readonly all?: boolean
  readonly workspaceRoots?: readonly string[]
  readonly projectPaths?: readonly string[]
  readonly hiveRootSessionIds?: readonly string[]
}) {
  return (
    scope.all ||
    [scope.workspaceRoots, scope.projectPaths, scope.hiveRootSessionIds].some(
      (values) => (values?.length ?? 0) > 0,
    )
  )
}

export function createLocalSessionEventAdmissionFilter(
  resolveCaller: () => AuthenticatedLocalSessionCaller | null,
) {
  return (event: SessionHostEventEnvelope) => {
    const caller = resolveCaller()
    if (!caller) return false
    const authority = caller.profileAuthority
    if (!authority) return true
    const scope = caller.baseProfileScope ?? authority.scope
    const requiresAsyncAdmission = requiresAsynchronousAdmission(scope)
    const allowedSessionIds = new Set(scope.sessionIds ?? [])
    for (const derived of caller.derivedSessionAuthorities ?? []) {
      allowedSessionIds.add(derived.sessionId)
    }
    if (event.payload.kind === 'semantic-discovery-readiness-changed') return false
    return requiresAsyncAdmission || allowedSessionIds.has(event.payload.sessionId)
  }
}
