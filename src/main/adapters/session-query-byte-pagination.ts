import { SESSION_QUERY_MAX_RESPONSE_BYTES } from '@shared/types/session-query'

// Bound JSON fetched and parsed before exact response accounting. The response
// budget retains 8 MiB for field names, identifiers, and protocol envelopes.
export const SESSION_QUERY_SQL_READ_BUDGET_BYTES = 40 * 1024 * 1024

export type ByteBoundedPage<T> =
  | { readonly accepted: true; readonly records: readonly T[]; readonly hasMore: boolean }
  | { readonly accepted: false }

function jsonBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

/**
 * Selects the largest prefix whose complete protocol response stays within the
 * query response budget. `emptyResponse` must place `records` at the same array
 * position used by the final response.
 */
export function byteBoundedPage<T>(input: {
  readonly candidates: readonly T[]
  readonly hasAdditionalCandidates: boolean
  readonly emptyResponse: unknown
}): ByteBoundedPage<T> {
  const emptyResponseBytes = jsonBytes(input.emptyResponse)
  if (emptyResponseBytes > SESSION_QUERY_MAX_RESPONSE_BYTES) return { accepted: false }
  const records: T[] = []
  let responseBytes = emptyResponseBytes
  for (const candidate of input.candidates) {
    const candidateBytes = jsonBytes(candidate) + (records.length === 0 ? 0 : 1)
    if (responseBytes + candidateBytes > SESSION_QUERY_MAX_RESPONSE_BYTES) {
      return records.length === 0 ? { accepted: false } : { accepted: true, records, hasMore: true }
    }
    records.push(candidate)
    responseBytes += candidateBytes
  }
  return {
    accepted: true,
    records,
    hasMore: input.hasAdditionalCandidates,
  }
}
