import { TERMINAL } from '@shared/constants/resource-limits'
import { createLogger } from '../../logger'

const logger = createLogger('terminal-process-poll-scheduler')
const MAX_POLL_DELAY_MS = 60_000
const BACKOFF_MULTIPLIER = 2

/** Schedule after completion, so slow probes cannot overlap or trigger catch-up bursts. */
export function makeTerminalProcessPollScheduler(poll: () => Promise<boolean>) {
  let timer: NodeJS.Timeout | null = null
  let active = false
  let running = false
  let queued = false
  let delay: number = TERMINAL.ACTIVITY_POLL_MS

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const run = async () => {
    if (!active) return
    if (running) {
      queued = true
      return
    }
    clearTimer()
    running = true
    try {
      delay = (await poll())
        ? TERMINAL.ACTIVITY_POLL_MS
        : Math.min(delay * BACKOFF_MULTIPLIER, MAX_POLL_DELAY_MS)
    } catch (error) {
      delay = Math.min(delay * BACKOFF_MULTIPLIER, MAX_POLL_DELAY_MS)
      logger.warn('Terminal metadata poll rejected', {
        error: error instanceof Error ? error.message : String(error),
        retryAfterMs: delay,
      })
    } finally {
      running = false
      if (active) {
        timer = setTimeout(() => void run(), queued ? 0 : delay)
        timer.unref?.()
      }
      queued = false
    }
  }

  return {
    update(shouldPoll: boolean, targetsChanged = false) {
      const wasActive = active
      active = shouldPoll
      if (!active) {
        clearTimer()
        queued = false
        delay = TERMINAL.ACTIVITY_POLL_MS
        return
      }
      if (!wasActive || targetsChanged) void run()
    },
  }
}
