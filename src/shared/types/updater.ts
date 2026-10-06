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
      /** Why the previous Restart to update did not install this version, if it did not. */
      readonly installFailure?: string
    }
  /** Restart to update is quitting the app; the installer reopens it on the new version. */
  | { readonly type: 'installing'; readonly version: string }
  | { readonly type: 'error'; readonly message: string }
