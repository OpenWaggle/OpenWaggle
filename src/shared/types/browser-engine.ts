/** Why installing the browser engine failed; every failure can be retried. */
export type BrowserEngineFailureReason = 'offline' | 'http' | 'integrity' | 'install'

/**
 * The Browser preview's engine (CEF) as a downloadable component on macOS. Other platforms, and
 * builds that bundle the engine, are `ready` at once. Broadcast from main to renderers via
 * `browser-engine:status-changed`.
 */
export type BrowserEngineStatus =
  | { readonly type: 'idle' }
  | { readonly type: 'checking' }
  | { readonly type: 'downloading'; readonly receivedBytes: number; readonly totalBytes: number }
  | { readonly type: 'installing' }
  | { readonly type: 'ready' }
  | {
      readonly type: 'failed'
      readonly reason: BrowserEngineFailureReason
      readonly message: string
    }
