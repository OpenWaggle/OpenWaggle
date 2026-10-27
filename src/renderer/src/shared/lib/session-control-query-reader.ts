import type { SessionQueryRequest, SessionQueryResponse } from '@shared/types/session-query'

/**
 * Session Control queries only read, so identical ones asked in the same task share one Host
 * round trip (boot fetch dedupe): opening a Session asked for its Follow-up queue four times at
 * once from the composer, the dock, the status monitor and the chat view. The request id differs
 * per caller and no caller reads it back, so it is left out of the key. Only calls in the same
 * task are joined; a later call always reads again.
 */
export function createSessionControlQueryReader(
  query: (request: SessionQueryRequest) => Promise<SessionQueryResponse>,
) {
  const inFlight = new Map<string, Promise<SessionQueryResponse>>()
  return (request: SessionQueryRequest): Promise<SessionQueryResponse> => {
    const key = JSON.stringify([request.contractVersion, request.query])
    const shared = inFlight.get(key)
    if (shared) return shared
    const promise = query(request)
    inFlight.set(key, promise)
    queueMicrotask(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key)
    })
    return promise
  }
}
