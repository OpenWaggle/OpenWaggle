import {
  SESSION_HOST_LIVENESS_KINDS,
  type SessionHostLiveness,
  type SessionHostLivenessKind,
} from '../application/session-host-liveness'
import { createLogger } from '../logger'
import { startEventLoopStallMonitor } from '../utils/event-loop-stall-monitor'
import type { LocalSessionInflightCommands } from './local-session-inflight-commands'

const logger = createLogger('session-host/runtime')

/**
 * Every client of this Host times out when its single event loop is blocked, and the Host itself
 * cannot log while blocked, so stalls used to leave no trace here. Record each one afterwards with
 * the commands and liveness owners that were active.
 */
export function monitorSessionHostEventLoop(
  liveness: SessionHostLiveness,
  inflightCommands: LocalSessionInflightCommands,
) {
  return startEventLoopStallMonitor({
    logger,
    message: 'Session Host event loop stalled; clients may have timed out.',
    describe: () => {
      const livenessOwners: Partial<Record<SessionHostLivenessKind, number>> = {}
      for (const kind of SESSION_HOST_LIVENESS_KINDS) {
        const count = liveness.ownerCount(kind)
        if (count !== 0) livenessOwners[kind] = count
      }
      return { ...inflightCommands.describe(), livenessOwners }
    },
  })
}
