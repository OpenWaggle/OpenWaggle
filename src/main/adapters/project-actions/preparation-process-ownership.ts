import { setTimeout } from 'node:timers/promises'
import type { ActionProcess } from './action-process'

const STOP_RETRY_MS = 1_000

/** A preparation attempt still owns its workspace and Host lease until its entire tree stops. */
export function createPreparationProcessOwnership() {
  const active = new Map<ActionProcess, (chunk: string) => void>()
  const stopping = new Map<ActionProcess, Promise<void>>()
  function stop(child: ActionProcess) {
    const pending = stopping.get(child)
    if (pending) return pending
    const operation = (async () => {
      let reported = false
      while (active.has(child)) {
        try {
          await child.stop()
          active.delete(child)
          return
        } catch {
          if (!reported)
            active.get(child)?.(
              '\nWaiting for the preparation process tree to stop. OpenWaggle is retrying; this workspace remains reserved.\n',
            )
          reported = true
          await setTimeout(STOP_RETRY_MS)
        }
      }
    })()
    stopping.set(child, operation)
    void operation.finally(() => stopping.delete(child)).catch(() => {})
    return operation
  }
  return {
    add: (child: ActionProcess, onOutput: (chunk: string) => void) => active.set(child, onOutput),
    stop,
    stopAll: () => Promise.all([...active.keys()].map(stop)),
  }
}
