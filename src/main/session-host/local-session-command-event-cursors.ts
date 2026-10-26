import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import type { SessionHostEventCursor } from '@shared/types/session-host-event'
import type { LocalSessionCursorResolution } from './local-session-event-cursor-projection'

/**
 * Maps the caller's opaque `after` cursor of a `wait` or `exports-wait` to the Host's own cursor.
 *
 * A wait reads the canonical state before it subscribes, so `after` only decides which events
 * wake it early, never what it answers. A cursor the Host can no longer resolve (restarted Host,
 * expired or foreign cursor) is therefore dropped rather than answered with `resync_required`:
 * the caller has nothing to resynchronize, and the wait starts from the current state instead.
 */
export function resolveLocalSessionCommandCursor(
  payload: LocalSessionCommandPayload,
  resolve: (cursor: SessionHostEventCursor) => LocalSessionCursorResolution,
): LocalSessionCommandPayload {
  if (payload.contract !== 'session-query-v2') return payload
  const query = payload.request.query
  if ((query.operation !== 'wait' && query.operation !== 'exports-wait') || !query.after) {
    return payload
  }
  const resolution = resolve(query.after)
  const { after: _rejected, ...withoutAfter } = query
  return {
    ...payload,
    request: {
      ...payload.request,
      query: resolution.status === 'ready' ? { ...query, after: resolution.cursor } : withoutAfter,
    },
  }
}

export function exposeLocalSessionCommandResultCursor(
  result: LocalSessionCommandResult,
  expose: (cursor: SessionHostEventCursor) => SessionHostEventCursor,
): LocalSessionCommandResult {
  if (result.contract !== 'session-query-v2') return result
  const outcome = result.response.outcome
  if (
    (outcome.operation !== 'wait' && outcome.operation !== 'exports-wait') ||
    'error' in outcome
  ) {
    return result
  }
  return {
    ...result,
    response: {
      ...result.response,
      outcome: { ...outcome, cursor: expose(outcome.cursor) },
    },
  }
}
