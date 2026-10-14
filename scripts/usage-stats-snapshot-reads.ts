/**
 * The GET requests of the daily snapshot job (./usage-stats-snapshot.ts): every read is bounded by
 * `REQUEST_TIMEOUT_MS`, body included, and optional data turns a failed read into its reason.
 */
import { isMatching, P } from '@diegogbrisa/ts-match'
import { REQUEST_TIMEOUT_MS, type SnapshotJobOptions } from './usage-stats-snapshot-endpoint'

const hasCode = isMatching({ code: P.string })

export async function getJson(options: SnapshotJobOptions, url: string, headers: Record<string, string>) {
  const response = await options.fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body: unknown = response.ok ? await response.json() : undefined
  if (!response.ok) await response.body?.cancel()
  return { response, body }
}

/** A failed read's message, with its network cause's code (ECONNRESET, UND_ERR_SOCKET) when it has one. */
function failureReason(error: unknown) {
  if (!(error instanceof Error)) return String(error)
  const cause: unknown = error.cause
  return hasCode(cause) ? `${error.message}: ${cause.code}` : error.message
}

export type JsonRead =
  | { readonly response: Response; readonly body: unknown; readonly failure?: undefined }
  | { readonly failure: string }

/**
 * `getJson` for optional data: a read that throws (a timeout, a network failure, a body that
 * stalls or is not JSON) comes back as its reason instead of failing the snapshot.
 */
export async function readOptionalJson(
  options: SnapshotJobOptions,
  url: string,
  headers: Record<string, string>,
): Promise<JsonRead> {
  try {
    return await getJson(options, url, headers)
  } catch (error) {
    return { failure: failureReason(error) }
  }
}
