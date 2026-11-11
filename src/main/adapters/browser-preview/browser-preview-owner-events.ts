import type {
  BrowserPreviewKeyEvent,
  BrowserPreviewShortcutEvent,
  BrowserPreviewState,
} from '@shared/types/browser-preview'
import type { RendererSurface } from '../../ports/desktop-shell/renderer-surfaces'

/** A preview that reports to the renderer page owning it. */
export interface BrowserPreviewOwnerEventTarget {
  readonly disposed: boolean
  readonly state: BrowserPreviewState
  readonly owner: { readonly sender: RendererSurface }
  readonly onOwnerEventFailure: () => void
}

export function emitBrowserPreviewState(record: BrowserPreviewOwnerEventTarget) {
  sendBrowserPreviewOwnerEvent(record, {
    channel: 'browser-preview:state',
    payload: record.state,
  })
}

type BrowserPreviewOwnerEvent =
  | {
      readonly channel: 'browser-preview:state'
      readonly payload: BrowserPreviewState
    }
  | {
      readonly channel: 'browser-preview:shortcut'
      readonly payload: BrowserPreviewShortcutEvent
      readonly focusOwner: true
    }
  | {
      readonly channel: 'browser-preview:key-event'
      readonly payload: BrowserPreviewKeyEvent
    }

/** Sends to the renderer that owns the native view without throwing through shell listeners. */
export function sendBrowserPreviewOwnerEvent(
  record: BrowserPreviewOwnerEventTarget,
  event: BrowserPreviewOwnerEvent,
) {
  if (record.disposed || record.owner.sender.isDestroyed()) return
  try {
    if ('focusOwner' in event) record.owner.sender.focus()
    record.owner.sender.send(event.channel, event.payload)
  } catch {
    record.onOwnerEventFailure()
  }
}
