import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import type { SessionHostEventCursor } from '@shared/types/session-host-event'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import type { LocalSessionCursorResolution } from './local-session-event-cursor-projection'

export type LocalSessionCommandCursorResolution =
  | { readonly status: 'ready'; readonly payload: LocalSessionCommandPayload }
  | {
      readonly status: 'resync-required'
      readonly result: Extract<LocalSessionCommandResult, { readonly contract: 'session-query-v2' }>
    }

export function resolveLocalSessionCommandCursor(
  payload: LocalSessionCommandPayload,
  resolve: (cursor: SessionHostEventCursor) => LocalSessionCursorResolution,
): LocalSessionCommandCursorResolution {
  if (payload.contract !== 'session-query-v2') return { status: 'ready', payload }
  const query = payload.request.query
  if ((query.operation !== 'wait' && query.operation !== 'exports-wait') || !query.after) {
    return { status: 'ready', payload }
  }
  const resolution = resolve(query.after)
  if (resolution.status === 'ready') {
    return {
      status: 'ready',
      payload: {
        ...payload,
        request: {
          ...payload.request,
          query: { ...query, after: resolution.cursor },
        },
      },
    }
  }
  return {
    status: 'resync-required',
    result: {
      contract: 'session-query-v2',
      response: {
        contractVersion: SESSION_QUERY_CONTRACT_VERSION,
        requestId: payload.request.requestId,
        outcome: {
          operation: query.operation,
          error: {
            code: 'resync_required',
            message: `Session event resynchronization is required: ${resolution.reason}.`,
          },
        },
      },
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
