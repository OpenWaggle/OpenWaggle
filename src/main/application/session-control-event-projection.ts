import type { SessionControlMutationResponse } from '@shared/types/session-control'
import { publishSessionHostEvent } from '../session-host/session-host-events'

/**
 * The Host cleared a Delegation's `needs_attention` (ADR 0059): a new Run started after a failed
 * one, or the parent answered a Worker's request for help. Like every Delegation state change,
 * the parent and the Worker publish a list change, so their Hive views refresh.
 */
export function publishDelegationAttentionCleared(
  cleared: { readonly parentSessionId: string; readonly workerSessionId: string } | undefined,
) {
  if (cleared === undefined) return
  for (const sessionId of [cleared.parentSessionId, cleared.workerSessionId]) {
    publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
  }
}

function publishSessionStateChange(outcome: SessionControlMutationResponse['outcome']) {
  if (!('stateRevision' in outcome)) return
  publishSessionHostEvent({
    kind: 'session-state-changed',
    sessionId: outcome.sessionId,
    stateRevision: outcome.stateRevision,
    operation: outcome.operation,
  })
}

function publishOrganizationChange(outcome: SessionControlMutationResponse['outcome']) {
  if (
    outcome.effect !== 'session-renamed' &&
    outcome.effect !== 'session-archived' &&
    outcome.effect !== 'session-unarchived' &&
    outcome.effect !== 'session-handed-off'
  ) {
    return false
  }
  const change =
    outcome.effect === 'session-archived'
      ? 'archived'
      : outcome.effect === 'session-unarchived'
        ? 'unarchived'
        : 'updated'
  publishSessionHostEvent({ kind: 'session-list-changed', sessionId: outcome.sessionId, change })
  return true
}

function skipControlProjection(response: SessionControlMutationResponse) {
  return (
    response.replayed ||
    response.outcome.effect === 'rejected' ||
    publishOrganizationChange(response.outcome)
  )
}

export function publishControlResponse(response: SessionControlMutationResponse) {
  if (skipControlProjection(response)) return
  if (response.outcome.effect === 'authorization-updated') {
    publishSessionHostEvent({
      kind: 'session-list-changed',
      sessionId: response.outcome.sessionId,
      change: 'updated',
    })
    return
  }
  if (response.outcome.effect === 'accepted-report') {
    for (const targetSessionId of response.outcome.targetSessionIds) {
      publishSessionHostEvent({
        kind: 'session-list-changed',
        sessionId: targetSessionId,
        change: 'updated',
      })
    }
    return
  }
  if (response.outcome.effect === 'delegation-updated') {
    for (const sessionId of [response.outcome.parentSessionId, response.outcome.workerSessionId]) {
      publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
    }
    return
  }
  if (response.outcome.effect === 'descendant-interruptions-requested') {
    for (const interrupted of response.outcome.interrupted) {
      publishSessionHostEvent({
        kind: 'session-state-changed',
        sessionId: interrupted.sessionId,
        stateRevision: interrupted.stateRevision,
        operation: response.outcome.operation,
      })
    }
    return
  }
  if (
    response.outcome.effect === 'delegation-claims-updated' ||
    response.outcome.effect === 'delegation-conflict-acknowledged' ||
    response.outcome.effect === 'delegation-dependencies-updated' ||
    response.outcome.effect === 'delegation-amendment-proposed' ||
    response.outcome.effect === 'delegation-specification-amended' ||
    response.outcome.effect === 'delegation-verification-recorded'
  ) {
    publishSessionHostEvent({
      kind: 'session-list-changed',
      sessionId: response.outcome.sessionId,
      change: 'updated',
    })
    return
  }
  publishSessionStateChange(response.outcome)
}
