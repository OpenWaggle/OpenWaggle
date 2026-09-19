import { useEffect, useRef, useState } from 'react'
import { useSessionStatusStore } from '@/features/sessions/state'
import type { SidebarRowState } from '../lib/sidebar-row-state'
import { queryTerminalSidebarCounts } from './remote-sidebar-session-query'
import { terminalStateRefreshKey } from './remote-sidebar-terminal-status'

export interface ExactTerminalCounts {
  readonly completed?: number
  readonly error?: number
}

export function useSidebarTerminalCounts(stateBySessionId: ReadonlyMap<string, SidebarRowState>) {
  const [terminalCounts, setTerminalCounts] = useState<ExactTerminalCounts>({})
  const countGeneration = useRef(0)
  const terminalStateKey = terminalStateRefreshKey(stateBySessionId)
  const terminalReceiptRevision = useSessionStatusStore((state) => state.terminalReceiptRevision)

  useEffect(() => {
    const refreshKey = `${terminalStateKey}\u0001${terminalReceiptRevision}`
    countGeneration.current += 1
    const requestGeneration = countGeneration.current
    void queryTerminalSidebarCounts(refreshKey)
      .then((result) => {
        if (countGeneration.current === requestGeneration && result.refreshKey === refreshKey) {
          setTerminalCounts(result.counts)
        }
      })
      .catch(() => {
        if (countGeneration.current === requestGeneration) {
          // An old Host count must not override the locally known rows after a failed refresh.
          setTerminalCounts({})
        }
      })
  }, [terminalStateKey, terminalReceiptRevision])

  return { terminalCounts, setTerminalCounts }
}
