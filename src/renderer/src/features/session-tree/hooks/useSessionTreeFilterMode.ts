import type { SessionTreeFilterMode } from '@shared/types/session'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { isSessionTreeFilterMode } from '../constants'

export function useSessionTreeFilterMode(
  projectPath: string | null,
  showToast: (message: string) => void,
) {
  const [filterMode, setFilterMode] = useState<SessionTreeFilterMode>('default')

  useEffect(() => {
    let cancelled = false
    void api
      .getPiTreeFilterMode(projectPath)
      .then((mode) => {
        if (!cancelled) {
          setFilterMode(mode)
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`Failed to load Session Tree filter: ${message}`)
      })

    return () => {
      cancelled = true
    }
  }, [projectPath, showToast])

  function persistFilterMode(mode: SessionTreeFilterMode) {
    void api.setPiTreeFilterMode(mode, projectPath).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`Failed to save Session Tree filter: ${message}`)
    })
  }

  function updateFilterMode(value: string) {
    if (!isSessionTreeFilterMode(value)) {
      return
    }
    setFilterMode(value)
    persistFilterMode(value)
  }

  return { filterMode, updateFilterMode }
}
