import type { DesktopServiceRequest } from '@shared/types/desktop-service'
import { executeLocalSessionCommand } from './local-session-client'
import type { LocalSessionHostPaths } from './local-session-paths'

const REQUEST_TIMEOUT_MS = 10_000

/** One desktop-service round trip to the Host endpoint current at call time. */
export function makeGuiDesktopServiceRequest(
  paths: () => LocalSessionHostPaths,
  clientVersion: string,
) {
  return async (message: DesktopServiceRequest) => {
    const result = await executeLocalSessionCommand({
      paths: paths(),
      clientVersion,
      clientKind: 'gui',
      // Transport negotiation uses the standard supported revisions; the desktop contract is
      // revision-gated per command, so pinning the handshake to it fails once it leaves the window.
      timeoutMs: REQUEST_TIMEOUT_MS,
      payload: { contract: 'desktop-service-v1', request: message },
    })
    if (result.contract !== 'desktop-service-v1')
      throw new Error('Invalid desktop-service response contract.')
    return result.response
  }
}
