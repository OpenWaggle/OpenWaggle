import type { GuiStartupStatus } from '@shared/types/gui-startup'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('app-startup')
const STARTING: GuiStartupStatus = { state: 'starting' }

/**
 * The window's startup state from main (A-F2): subscribed first, then read once, so a change
 * between the two is never missed. An event always wins over the initial read it overtook.
 */
export function useGuiStartupStatus(): GuiStartupStatus {
  const [status, setStatus] = useState<GuiStartupStatus>(STARTING)

  useEffect(() => {
    let changed = false
    let active = true
    const unsubscribe = api.onStartupStatusChanged((next) => {
      changed = true
      setStatus(next)
    })
    api.getStartupStatus().then(
      (initial) => {
        if (active && !changed) setStatus(initial)
      },
      (error: unknown) => {
        logger.warn('Could not read the startup status', { error: String(error) })
      },
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return status
}

export function retryGuiStartup() {
  api.retryStartup().catch((error: unknown) => {
    logger.warn('Could not retry startup', { error: String(error) })
  })
}

export function openStartupLogs() {
  api.openLogsDir().catch((error: unknown) => {
    logger.warn('Could not open the logs folder', { error: String(error) })
  })
}
