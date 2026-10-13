import type { SessionId } from '@shared/types/brand'

/*
 * Reads of a Session's detail race each other and the Session's own changes: a reply is kept only
 * while no later read started and nothing changed the Session meanwhile.
 */

const latestSessionRead = new Map<SessionId, number>()
const latestSessionMutation = new Map<SessionId, number>()

export function sessionMutationVersion(id: SessionId) {
  return latestSessionMutation.get(id) ?? 0
}

export function markSessionMutation(id: SessionId) {
  latestSessionMutation.set(id, sessionMutationVersion(id) + 1)
}

/** Starts a read of the Session's detail; a later read, or a change of it, makes its reply stale. */
export function beginSessionRead(id: SessionId) {
  const requestId = (latestSessionRead.get(id) ?? 0) + 1
  latestSessionRead.set(id, requestId)
  const version = sessionMutationVersion(id)
  return {
    /** No later read started. */
    isLatest: () => latestSessionRead.get(id) === requestId,
    /** No later read started, and nothing changed the Session. */
    isCurrent: () =>
      latestSessionRead.get(id) === requestId && sessionMutationVersion(id) === version,
  }
}
