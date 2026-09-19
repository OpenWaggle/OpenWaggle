import { useEffect, useRef, useState } from 'react'
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

  useEffect(() => {
    countGeneration.current += 1
    const requestGeneration = countGeneration.current
    void queryTerminalSidebarCounts(terminalStateKey)
      .then((result) => {
        if (
          countGeneration.current === requestGeneration &&
          result.refreshKey === terminalStateKey
        ) {
          setTerminalCounts(result.counts)
        }
      })
      .catch(() => undefined)
  }, [terminalStateKey])

  return { terminalCounts, setTerminalCounts }
}
