import { useLayoutEffect } from 'react'
import { api } from '@/shared/lib/ipc'
import { useTerminalActivityStore } from '../state/terminal-activity-store'
import { useTerminalStore } from '../state/terminal-store'

/**
 * One workspace-level subscription for every terminal, including records with
 * no mounted drawer or side-panel surface. Main's existing shared inspector is
 * the only poller; this monitor only applies pushed metadata snapshots.
 */
export function useTerminalActivityMonitor(): void {
  const applySnapshot = useTerminalActivityStore((state) => state.applySnapshot)

  useLayoutEffect(() => {
    let disposed = false
    const apply = (snapshot: Parameters<typeof applySnapshot>[0]) => {
      applySnapshot(snapshot)
      // Zustand updates synchronously. Project into the durable layout store
      // only when this exact revision won the activity-store race.
      if (useTerminalActivityStore.getState().revision === snapshot.revision) {
        useTerminalStore.getState().applyRuntimeSnapshot(snapshot.summaries, snapshot.truncated)
      }
    }
    const unsubscribe = api.onTerminalActivitySnapshot(apply)
    void api
      .getTerminalActivitySnapshot()
      .then((snapshot) => {
        if (!disposed) apply(snapshot)
      })
      .catch(() => {
        // Missing metadata stays `unknown`; consumers must not reuse a
        // terminal unless the main process explicitly reports `idle`.
      })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [applySnapshot])
}
