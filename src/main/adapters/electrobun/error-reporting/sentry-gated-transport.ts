/**
 * The Sentry transport of the Bun main process and Session Host (ADR 0045): Bun's `fetch`
 * transport (which follows the system proxy the boot shell applied), with no offline queue, so no
 * report is ever written to disk, that sends only error
 * events this process's `beforeSend` scrubbed, and only while Usage statistics are on. It is the
 * last check before a report leaves the machine, whatever the SDK, a future default or a
 * renderer's hand-made envelope produced.
 */

import { makeFetchTransport } from '@sentry/bun'
import { retainErrorEventsOnly } from '@shared/error-reporting/error-report-envelope'

type FetchTransportOptions = Parameters<typeof makeFetchTransport>[0]
type FetchTransport = ReturnType<typeof makeFetchTransport>

/**
 * Wraps Bun's `fetch` transport so it sends only the error events `wasScrubbed` accepts, and only
 * while `isEnabled`.
 */
export function createGatedFetchTransport(
  isEnabled: () => boolean,
  wasScrubbed: (event: unknown) => boolean,
) {
  return (options: FetchTransportOptions): FetchTransport => {
    const transport = makeFetchTransport(options)
    return {
      send: (envelope) =>
        isEnabled() && retainErrorEventsOnly(envelope, wasScrubbed)
          ? transport.send(envelope)
          : Promise.resolve({}),
      flush: (timeout) => transport.flush(timeout),
    }
  }
}
