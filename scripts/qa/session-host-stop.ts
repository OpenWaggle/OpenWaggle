import { LOCAL_HOST_CONTRACT_VERSION } from '../../src/shared/types/local-host'
import { LOCAL_SESSION_CURRENT_REVISION } from '../../src/shared/types/local-session-protocol'
import { executeLocalSessionCommand } from '../../src/main/session-host/local-session-client'
import {
  LocalSessionHostUpgradePendingError,
  openLocalSessionConnection,
} from '../../src/main/session-host/local-session-client-connection'
import type { LocalSessionHostPaths } from '../../src/main/session-host/local-session-paths'
import { isRejectedUpdatePurpose } from '../../src/main/session-host/session-host-update-stop'

const QA_HOST_CLIENT_VERSION = 'qa-graceful-shutdown'
const FUTURE_PROTOCOL_REVISION = LOCAL_SESSION_CURRENT_REVISION + 1

export function hasErrorCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code
}

export function processExists(processId: number) {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return hasErrorCode(error, 'EPERM')
  }
}

async function requestDrain(paths: LocalSessionHostPaths) {
  try {
    const connection = await openLocalSessionConnection({
      paths,
      clientKind: 'internal',
      clientVersion: QA_HOST_CLIENT_VERSION,
      supportedRevisions: [FUTURE_PROTOCOL_REVISION],
    })
    connection.socket.destroy()
    throw new Error('The Session Host unexpectedly accepted the QA shutdown revision.')
  } catch (error) {
    if (!(error instanceof LocalSessionHostUpgradePendingError)) throw error
  }
}

/**
 * The update stop, which names the Host's process (ADR 0047). A Host already draining for a
 * version handoff answers nothing else, and that drain is the stop.
 */
export async function requestStop(paths: LocalSessionHostPaths) {
  try {
    const result = await executeLocalSessionCommand({
      paths,
      clientKind: 'internal',
      clientVersion: QA_HOST_CLIENT_VERSION,
      payload: {
        contract: 'local-host-v1',
        request: {
          contractVersion: LOCAL_HOST_CONTRACT_VERSION,
          operation: 'stop',
          purpose: 'update',
        },
      },
    })
    if (result.contract !== 'local-host-v1') {
      throw new Error('The Session Host returned an unexpected response to the QA stop.')
    }
    return result.response.processId
  } catch (error) {
    if (error instanceof LocalSessionHostUpgradePendingError) return undefined
    if (!isRejectedUpdatePurpose(error)) throw error
    // A Host older than the update stop refuses its purpose; the version handoff still drains it.
    await requestDrain(paths)
    return undefined
  }
}
