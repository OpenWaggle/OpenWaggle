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
  | { readonly type: 'downloaded'; readonly version: string }
  | { readonly type: 'error'; readonly message: string }
