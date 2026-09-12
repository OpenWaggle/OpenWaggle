import type {
  BrowserPreviewKeyEvent,
  BrowserPreviewShortcutEvent,
  BrowserPreviewState,
} from '@shared/types/browser-preview'
import type { BrowserPreviewRecord } from './browser-preview-records'

export function emitBrowserPreviewState(record: BrowserPreviewRecord) {
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

/** Sends to the renderer that owns the native view without throwing through Electron listeners. */
export function sendBrowserPreviewOwnerEvent(
  record: BrowserPreviewRecord,
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
