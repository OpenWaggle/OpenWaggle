/**
 * Discriminated union representing the auto-updater lifecycle.
 * Broadcast from main → renderer via 'updater:status-changed'.
 */
export type UpdateStatus =
  | { readonly type: 'idle' }
  | { readonly type: 'checking' }
  | { readonly type: 'available'; readonly version: string }
  | { readonly type: 'not-available' }
  | { readonly type: 'downloading'; readonly version: string; readonly percent: number }
  | {
      readonly type: 'downloaded'
      readonly version: string
      /** Set while Restart when idle waits for this many active agent runs to finish. */
      readonly waitingForRuns?: number
    }
  | { readonly type: 'error'; readonly message: string }
