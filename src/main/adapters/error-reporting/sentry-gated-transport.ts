/**
 * The Sentry transport of the Electron main process (ADR 0045): Electron's `net` transport
 * without the SDK's offline queue, so no report is ever written to disk, that sends only error
 * events this process's `beforeSend` scrubbed, and only while Usage statistics are on. It is the
 * last check before a report leaves the machine, whatever the SDK, a future default or a
 * renderer's hand-made envelope produced: the SDK passes some renderer envelopes straight to
 * the transport.
 */

import { makeElectronTransport } from '@sentry/electron/main'
import { retainErrorEventsOnly } from '@shared/error-reporting/error-report-envelope'

type ElectronTransportOptions = Parameters<typeof makeElectronTransport>[0]
type ElectronTransport = ReturnType<typeof makeElectronTransport>

/**
 * Wraps Electron's `net` transport so it sends only the error events `wasScrubbed` accepts, and
 * only while `isEnabled`.
 */
export function createGatedElectronTransport(
  isEnabled: () => boolean,
  wasScrubbed: (event: unknown) => boolean,
) {
  return (options: ElectronTransportOptions): ElectronTransport => {
    const transport = makeElectronTransport(options)
    return {
      send: (envelope) =>
        isEnabled() && retainErrorEventsOnly(envelope, wasScrubbed)
          ? transport.send(envelope)
          : Promise.resolve({}),
      flush: (timeout) => transport.flush(timeout),
    }
  }
}
