import type { SessionHiveReader } from './session-hive-contract'

export interface HiveHostEvent {
  readonly cursor: { readonly hostInstanceId: string; readonly sequence: number }
  readonly payload: { readonly kind: string }
}

export interface SessionHiveEventSource extends SessionHiveReader {
  readonly onSessionHostEvent?: (callback: (event: HiveHostEvent) => void) => () => void
  readonly onSessionHostResyncRequired?: (callback: () => void) => () => void
}

/** One subscription for all Hive queries. Token streams never trigger catalog reads. */
export function subscribeSessionHiveUpdates(
  source: SessionHiveEventSource,
  refresh: { readonly invalidate: () => void; readonly resync: () => void },
) {
  let active = true
  let scheduled = false
  let needsResync = false
  let cursor: HiveHostEvent['cursor'] | undefined
  function schedule() {
    if (!active || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (!active) return
      const reset = needsResync
      needsResync = false
      if (reset) refresh.resync()
      else refresh.invalidate()
    })
  }
  const unsubscribe =
    'onSessionHostEvent' in source
      ? source.onSessionHostEvent?.((event) => {
          if (!active) return
          if (
            cursor?.hostInstanceId === event.cursor.hostInstanceId &&
            event.cursor.sequence <= cursor.sequence
          )
            return
          cursor = event.cursor
          if (
            event.payload.kind === 'session-list-changed' ||
            event.payload.kind === 'session-state-changed'
          )
            schedule()
        })
      : undefined
  const unsubscribeResync =
    'onSessionHostResyncRequired' in source
      ? source.onSessionHostResyncRequired?.(() => {
          cursor = undefined
          needsResync = true
          schedule()
        })
      : undefined
  return () => {
    active = false
    unsubscribe?.()
    unsubscribeResync?.()
  }
}
