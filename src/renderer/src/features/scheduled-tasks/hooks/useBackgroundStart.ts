import type { BackgroundStartStatus } from '@shared/types/ipc-invoke-scheduled-tasks'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('scheduled-tasks/background-start')

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Background start (ADR 0057): read it once, and change it with the main process's answer. */
export function useBackgroundStart() {
  const [status, setStatus] = useState<BackgroundStartStatus | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof api.getBackgroundStart !== 'function') return
    let current = true
    api
      .getBackgroundStart()
      .then((next) => {
        if (current) setStatus(next)
      })
      .catch((cause: unknown) => {
        logger.warn('Failed to read Background start', { error: errorMessage(cause) })
        if (current) setError(errorMessage(cause))
      })
    return () => {
      current = false
    }
  }, [])

  const setEnabled = (enabled: boolean, onSuccess?: () => void) => {
    if (isSaving) return
    setIsSaving(true)
    setError(null)
    api
      .setBackgroundStart(enabled)
      .then((next) => {
        setStatus(next)
        if (next.enabled === enabled) {
          onSuccess?.()
          return
        }
        if (next.reason) setError(next.reason)
      })
      .catch((cause: unknown) => {
        logger.warn('Failed to change Background start', { error: errorMessage(cause) })
        setError(errorMessage(cause))
      })
      .finally(() => setIsSaving(false))
  }

  return { status, setEnabled, isSaving, error }
}
