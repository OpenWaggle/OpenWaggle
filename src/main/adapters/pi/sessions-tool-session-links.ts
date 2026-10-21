import { sessionIdFromReference, sessionIdsFromReferences } from '@shared/utils/session-link'
import type { SessionsToolParameters } from './sessions-tool-parameters'

type SessionsToolTarget = Extract<SessionsToolParameters, { readonly target: unknown }>['target']

function resolveTarget(target: SessionsToolTarget): SessionsToolTarget {
  if (target.type === 'session') {
    return { ...target, sessionId: sessionIdFromReference(target.sessionId, 'target.sessionId') }
  }
  if (target.type === 'sessions') {
    return {
      ...target,
      sessionIds: sessionIdsFromReferences(target.sessionIds, 'target.sessionIds'),
    }
  }
  return target
}

/**
 * Accept a Session link wherever the tool takes a Session identity (ADR 0056), so an agent can
 * use a link the user pasted as it is. Only identity fields change; the Host still decides
 * whether the named Session exists and whether this caller may reach it. A list that names one
 * Session twice, as a link and as its ID, keeps it once. Snapshot manifests are left exactly as
 * a previous export returned them.
 */
export function resolveSessionsToolSessionLinks(
  params: SessionsToolParameters,
): SessionsToolParameters {
  let resolved = params
  if ('sessionId' in resolved && resolved.sessionId !== undefined) {
    resolved = { ...resolved, sessionId: sessionIdFromReference(resolved.sessionId, 'sessionId') }
  }
  if ('sessionIds' in resolved) {
    resolved = {
      ...resolved,
      sessionIds: sessionIdsFromReferences(resolved.sessionIds, 'sessionIds'),
    }
  }
  if ('parentSessionId' in resolved && resolved.parentSessionId !== undefined) {
    resolved = {
      ...resolved,
      parentSessionId: sessionIdFromReference(resolved.parentSessionId, 'parentSessionId'),
    }
  }
  if ('workerSessionId' in resolved && resolved.workerSessionId !== undefined) {
    resolved = {
      ...resolved,
      workerSessionId: sessionIdFromReference(resolved.workerSessionId, 'workerSessionId'),
    }
  }
  if ('target' in resolved) resolved = { ...resolved, target: resolveTarget(resolved.target) }
  return resolved
}
