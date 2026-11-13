import type { BrowserPreviewOwnerWindow } from '../../browser-preview/browser-preview-owner-registry'

/** The parts of the Electrobun SDK an owner page's window is found and watched through. */
export interface ElectrobunWindowSdk {
  readonly BrowserView: {
    getById(id: number): { readonly windowId: number } | undefined
  }
  readonly BrowserWindow: { getById(id: number): object | undefined }
  /** The SDK's global emitter: a window's `close` event carries `{ data: { id } }`. */
  readonly events: {
    on(
      event: 'close',
      listener: (event: { readonly data: { readonly id: number } }) => void,
    ): unknown
    off(
      event: 'close',
      listener: (event: { readonly data: { readonly id: number } }) => void,
    ): unknown
  }
}

/** An owner page's Electrobun window: its id, and its `closed` lifetime for the owner registry. */
export interface ElectrobunOwnerWindow extends BrowserPreviewOwnerWindow {
  readonly id: number
}

/**
 * The window an owner page lives in. An Electrobun renderer surface's id is its `BrowserView` id,
 * and the view records its window; `null` when the page or its window is gone.
 */
export function electrobunOwnerWindow(sdk: ElectrobunWindowSdk, surfaceId: number) {
  const windowId = sdk.BrowserView.getById(surfaceId)?.windowId
  if (windowId === undefined || sdk.BrowserWindow.getById(windowId) === undefined) return null
  let closed = false
  const listeners = new Map<
    () => void,
    (event: { readonly data: { readonly id: number } }) => void
  >()
  return {
    id: windowId,
    isDestroyed: () => closed || sdk.BrowserWindow.getById(windowId) === undefined,
    once: (_event, listener) => {
      const onClose = (event: { readonly data: { readonly id: number } }) => {
        if (event.data.id !== windowId) return
        closed = true
        sdk.events.off('close', onClose)
        listeners.delete(listener)
        listener()
      }
      listeners.set(listener, onClose)
      sdk.events.on('close', onClose)
    },
    removeListener: (_event, listener) => {
      const onClose = listeners.get(listener)
      if (onClose === undefined) return
      listeners.delete(listener)
      sdk.events.off('close', onClose)
    },
  } satisfies ElectrobunOwnerWindow | null
}
