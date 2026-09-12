import { createLogger } from '../../logger'
import { performShutdown } from './terminal-process-shutdown-pipeline'
import type { TerminalRecord, TerminalTerminationState } from './terminal-records'

export { shutdownDetachedTerminal } from './terminal-detached-process-shutdown'
export {
  TERMINAL_FORCE_SHUTDOWN_MS,
  TERMINAL_GRACEFUL_SHUTDOWN_MS,
  TERMINAL_SHUTDOWN_PIPELINE_MS,
} from './terminal-process-control'
export { TERMINAL_PROCESS_SNAPSHOT_MS } from './terminal-process-tree'

const logger = createLogger('terminal-process-shutdown')

/**
 * Stop one exact spawn generation. Concurrent close/restart callers share the
 * same result; state is not cleared until PTY exit is confirmed.
 */
export function shutdownLiveTerminal(
  record: TerminalRecord,
  onLivePidsChanged: () => void,
): Promise<boolean> {
  if (record.termination !== null) return record.termination.result
  const live = record.live
  if (live === null) return Promise.resolve(true)

  let resolveResult: (stopped: boolean) => void = () => undefined
  const result = new Promise<boolean>((resolve) => {
    resolveResult = resolve
  })
  const state: TerminalTerminationState = {
    pty: live.pty,
    result,
    whenExited: live.processTreeExit.whenExited,
    get exitCode() {
      return live.processTreeExit.exitCode
    },
    notifyExit: live.processTreeExit.notifyExit,
  }
  record.termination = state
  onLivePidsChanged()

  void performShutdown(record, live, state, onLivePidsChanged)
    .catch((error: unknown) => {
      logger.error('Terminal shutdown pipeline failed', {
        pid: live.pid,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    })
    .then((stopped) => {
      if (record.termination === state) {
        record.termination = null
        if (!stopped) onLivePidsChanged()
      }
      resolveResult(stopped)
    })

  return result
}
