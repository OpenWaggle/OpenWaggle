import type { OutboundFetch } from './cloudflare'
import type { SentryProject } from './sentry-dsn'

const ENVELOPE_CONTENT_TYPE = 'application/x-sentry-envelope'
const FORWARD_TIMEOUT_MS = 10_000

/**
 * Posts an envelope to the project's ingestion URL. Sentry authenticates it through the DSN in
 * the envelope header, so no request header of the original client is ever forwarded.
 * Returns `undefined` when Sentry cannot be reached.
 */
export async function forwardSentryEnvelope(
  project: SentryProject,
  envelope: string,
  fetcher: OutboundFetch,
): Promise<Response | undefined> {
  try {
    return await fetcher(project.envelopeUrl, {
      method: 'POST',
      headers: { 'Content-Type': ENVELOPE_CONTENT_TYPE },
      body: envelope,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    })
  } catch {
    return undefined
  }
}
